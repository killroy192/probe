// @effect-diagnostics nodeBuiltinImport:off - synchronous git and file fixtures keep the worktree setups readable.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { expect } from "vite-plus/test";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import {
  GitCommandError,
  ShellLaunchError,
  type ShellOpenInput,
  type ShellSummary,
  type StartingScript,
  VcsProcessSpawnError,
} from "@t3tools/contracts";

import * as ServerConfig from "../config.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as StartingScripts from "../startingScripts/StartingScripts.ts";
import * as Shells from "../terminal/Shells.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as VcsProvisioningService from "../vcs/VcsProvisioningService.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import * as SavedWorkspaces from "./SavedWorkspaces.ts";

type Env =
  | SavedWorkspaces.SavedWorkspaces
  | ServerConfig.ServerConfig
  | FileSystem.FileSystem
  | Path.Path
  | Scope.Scope;

interface Fakes {
  readonly registered: string[];
  /** What each start opened; `script` is the typed command, absent for a plain shell. */
  readonly opened: Array<ShellOpenInput & { readonly script?: string }>;
  readonly titles: Array<string | undefined>;
  readonly worktrees?: Array<string | undefined>;
  /** Shells the fake started and has not killed. */
  readonly running?: ShellSummary[];
  readonly killed?: string[];
  initFails?: boolean;
  launchFails?: boolean;
  /** The user's starting scripts as saved now. */
  scripts?: StartingScript[];
  listingFails?: "worktrees" | "branches";
}

const listingError = (cwd: string) =>
  new GitCommandError({
    operation: "test",
    command: "git",
    cwd,
    detail: "git is unavailable",
  });

// The real driver, with one listing made to fail on request (ER-4, ER-6).
const layerGit = (fakes: Fakes) =>
  Layer.effect(
    GitVcsDriver.GitVcsDriver,
    Effect.gen(function* () {
      const real = yield* GitVcsDriver.GitVcsDriver;
      return GitVcsDriver.GitVcsDriver.of({
        ...real,
        listWorktrees: (cwd) =>
          fakes.listingFails === "worktrees"
            ? Effect.fail(listingError(cwd))
            : real.listWorktrees(cwd),
        listLocalBranchNames: (cwd) =>
          fakes.listingFails === "branches"
            ? Effect.fail(listingError(cwd))
            : real.listLocalBranchNames(cwd),
      });
    }),
  ).pipe(Layer.provide(GitVcsDriver.layer));

const layerRegistry = VcsDriverRegistry.layer.pipe(Layer.provide(VcsProcess.layer));

// Projects and shells are recorded; folders, git and the workspace files are real.
const layerDependencies = (fakes: Fakes) =>
  Layer.mergeAll(
    Layer.mock(ProjectService.ProjectService)({
      bootstrap: (input) =>
        Effect.sync(() => {
          fakes.registered.push(input.workspaceRoot);
          return { created: true } as never;
        }),
    }),
    Layer.mock(Shells.Shells)({
      open: (input, options) =>
        fakes.launchFails
          ? Effect.fail(new ShellLaunchError({ reason: "No agent command is configured." }))
          : Effect.sync(() => {
              fakes.opened.push(
                options?.script === undefined ? input : { ...input, script: options.script.command },
              );
              fakes.titles.push(options?.title);
              fakes.worktrees?.push(options?.worktree);
              const shell: ShellSummary = {
                shellId: `shell-${fakes.opened.length}`,
                cwd: input.cwd,
                status: "running" as const,
                pid: 1,
                exitCode: null,
                exitSignal: null,
                label: "shell",
                title: options?.title ?? null,
                process: null,
                project: options?.project ?? null,
                worktree: options?.worktree ?? null,
                branch: null,
                elsewhere: null,
                ended: null,
                missing: false,
                restored: false,
                updatedAt: "now",
              };
              fakes.running?.push(shell);
              return shell;
            }),
      list: Effect.sync(() => [...(fakes.running ?? [])]),
      kill: (shellId) =>
        Effect.sync(() => {
          fakes.killed?.push(shellId);
          const index = fakes.running?.findIndex((shell) => shell.shellId === shellId) ?? -1;
          if (index >= 0) fakes.running?.splice(index, 1);
        }),
    }),
    Layer.unwrap(
      Effect.sync(() =>
        fakes.initFails
          ? Layer.mock(VcsProvisioningService.VcsProvisioningService)({
              initRepository: () =>
                Effect.fail(
                  new VcsProcessSpawnError({
                    operation: "init",
                    command: "git init",
                    cwd: "/",
                    cause: new Error("git is broken"),
                  }),
                ),
            })
          : VcsProvisioningService.layer.pipe(Layer.provide(layerRegistry)),
      ),
    ),
    Layer.mock(StartingScripts.StartingScripts)({
      find: (id) =>
        Effect.sync(() => Option.fromNullishOr(fakes.scripts?.find((script) => script.id === id))),
    }),
    layerRegistry,
    layerGit(fakes),
    WorkspacePaths.layer,
  );

const withWorkspaces = <A, E>(
  seeds: Readonly<Record<string, string>>,
  body: (dir: string, fakes: Fakes) => Effect.Effect<A, E, Env>,
  fakes: Fakes = { registered: [], opened: [], titles: [] },
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-saved-workspaces-" });
    const dir = path.join(baseDir, "userdata", "workspaces");
    yield* fs.makeDirectory(dir, { recursive: true });
    for (const [file, contents] of Object.entries(seeds)) {
      yield* fs.writeFileString(path.join(dir, file), contents);
    }
    // Restore permissions so the scoped temp dir can be removed after a fault test.
    yield* Effect.addFinalizer(() => fs.chmod(dir, 0o755).pipe(Effect.ignore));
    return yield* body(dir, fakes).pipe(
      Effect.provide(
        SavedWorkspaces.layer.pipe(
          Layer.provide(layerDependencies(fakes)),
          Layer.provideMerge(ServerConfig.layerTest(process.cwd(), baseDir)),
        ),
      ),
    );
  }).pipe(Effect.scoped);

const service = SavedWorkspaces.SavedWorkspaces;
const names = Effect.gen(function* () {
  const workspaces = yield* (yield* service).list;
  return workspaces.map((workspace) => workspace.name);
});

it.layer(NodeServices.layer)("saved workspaces", (it) => {
  it.effect("creates a workspace as a file named after it and lists it", () =>
    withWorkspaces({}, (dir) =>
      Effect.gen(function* () {
        const workspaces = yield* service;
        const fs = yield* FileSystem.FileSystem;
        assert.deepStrictEqual(yield* workspaces.create({ name: "sparta" }), { name: "sparta" });
        yield* workspaces.create({ name: "athens" });
        assert.deepStrictEqual(yield* names, ["athens", "sparta"]);
        assert.strictEqual(yield* fs.readFileString(`${dir}/sparta.json`), '{"version":1}');
        assert.deepStrictEqual(yield* workspaces.open({ name: "sparta" }), {
          name: "sparta",
          projects: [],
          lastStarts: {},
          tabs: { shellIds: [], active: null },
        });
      }),
    ),
  );

  it.effect("rejects a name already taken, in any letter case, and keeps the file", () =>
    withWorkspaces({ "Sparta.json": '{"version":1}' }, () =>
      Effect.gen(function* () {
        const workspaces = yield* service;
        for (const name of ["Sparta", "sparta"]) {
          const error = yield* Effect.flip(workspaces.create({ name }));
          assert.strictEqual(error._tag, "WorkspaceNameTakenError");
        }
        assert.deepStrictEqual(yield* names, ["Sparta"]);
      }),
    ),
  );

  it.effect("lists only files whose name is a workspace name", () =>
    withWorkspaces(
      {
        "sparta.json": '{"version":1}',
        "notes.txt": "x",
        "con.json": '{"version":1}',
        " padded.json": '{"version":1}',
      },
      () =>
        Effect.gen(function* () {
          assert.deepStrictEqual(yield* names, ["sparta"]);
        }),
    ),
  );

  it.effect("removes only the workspace's file, leaving others and folders on disk", () =>
    withWorkspaces({ "sparta.json": '{"version":1}', "athens.json": '{"version":1}' }, (dir) =>
      Effect.gen(function* () {
        const workspaces = yield* service;
        const fs = yield* FileSystem.FileSystem;
        yield* fs.makeDirectory(`${dir}/athens`);
        yield* workspaces.remove({ name: "athens" });
        assert.deepStrictEqual(yield* names, ["sparta"]);
        assert.isTrue(yield* fs.exists(`${dir}/athens`));
        const missing = yield* Effect.flip(workspaces.remove({ name: "athens" }));
        assert.strictEqual(missing._tag, "WorkspaceNotFoundError");
      }),
    ),
  );

  it.effect("kills the shells of a removed workspace's projects, also another workspace's", () =>
    withWorkspaces(
      { "sparta.json": '{"version":1}', "athens.json": '{"version":1}' },
      (dir, fakes) =>
        Effect.gen(function* () {
          const workspaces = yield* service;
          const fs = yield* FileSystem.FileSystem;
          const [shared, own, elsewhere] = [`${dir}/shared`, `${dir}/own`, `${dir}/elsewhere`];
          for (const folder of [shared, own, elsewhere]) yield* fs.makeDirectory(folder);
          for (const folder of [shared, own]) {
            yield* workspaces.addProject({ mode: "import", name: "sparta", path: folder });
          }
          for (const folder of [shared, elsewhere]) {
            yield* workspaces.addProject({ mode: "import", name: "athens", path: folder });
          }
          const inOwn = yield* workspaces.startShell({ name: "sparta", project: own });
          const athensShared = yield* workspaces.startShell({ name: "athens", project: shared });
          const athensElsewhere = yield* workspaces.startShell({
            name: "athens",
            project: elsewhere,
          });

          yield* workspaces.remove({ name: "sparta" });

          expect(fakes.killed?.toSorted()).toEqual(
            [athensShared.shellId, inOwn.shellId].toSorted(),
          );
          expect(fakes.running?.map((shell) => shell.shellId)).toEqual([athensElsewhere.shellId]);
          for (const folder of [shared, own, elsewhere]) assert.isTrue(yield* fs.exists(folder));
          assert.deepStrictEqual(yield* names, ["athens"]);
        }),
      { registered: [], opened: [], titles: [], running: [], killed: [] },
    ),
  );

  it.effect("removes a project and kills its shells, keeping the folder and other projects", () =>
    withWorkspaces(
      { "sparta.json": '{"version":1}', "athens.json": '{"version":1}' },
      (dir, fakes) =>
        Effect.gen(function* () {
          const workspaces = yield* service;
          const fs = yield* FileSystem.FileSystem;
          const [gone, kept] = [`${dir}/gone`, `${dir}/kept`];
          for (const folder of [gone, kept]) {
            yield* fs.makeDirectory(folder);
            yield* workspaces.addProject({ mode: "import", name: "sparta", path: folder });
          }
          yield* workspaces.addProject({ mode: "import", name: "athens", path: gone });
          const inKept = yield* workspaces.startShell({ name: "sparta", project: kept });
          const inGone = yield* workspaces.startShell({ name: "sparta", project: gone });
          const athensInGone = yield* workspaces.startShell({ name: "athens", project: gone });

          const detail = yield* workspaces.removeProject({ name: "sparta", project: gone });

          expect(detail.projects.map((project) => project.path)).toEqual([kept]);
          // The removed project's remembered start leaves with it; the other's stays.
          assert.deepStrictEqual(detail.lastStarts, { [kept]: { worktree: { kind: "checkout" } } });
          assert.deepStrictEqual(yield* workspaces.open({ name: "sparta" }), detail);
          expect(fakes.killed?.toSorted()).toEqual(
            [inGone.shellId, athensInGone.shellId].toSorted(),
          );
          expect(fakes.running?.map((shell) => shell.shellId)).toEqual([inKept.shellId]);
          assert.isTrue(yield* fs.exists(gone));
          const again = yield* Effect.flip(
            workspaces.removeProject({ name: "sparta", project: gone }),
          );
          expect(again.message).toContain("not in the workspace");
        }),
      { registered: [], opened: [], titles: [], running: [], killed: [] },
    ),
  );

  it.effect("drops a project whose folder is gone once no shell is in it", () =>
    withWorkspaces(
      { "sparta.json": '{"version":1}' },
      (dir, fakes) =>
        Effect.gen(function* () {
          const workspaces = yield* service;
          const fs = yield* FileSystem.FileSystem;
          const [empty, busy, kept] = [`${dir}/empty`, `${dir}/busy`, `${dir}/kept`];
          for (const folder of [empty, busy, kept]) {
            yield* fs.makeDirectory(folder);
            yield* workspaces.addProject({ mode: "import", name: "sparta", path: folder });
          }
          const inBusy = yield* workspaces.startShell({ name: "sparta", project: busy });
          yield* fs.remove(empty, { recursive: true });
          yield* fs.remove(busy, { recursive: true });

          const opened = yield* workspaces.open({ name: "sparta" });
          expect(opened.projects.map(({ path, exists }) => [path, exists])).toEqual([
            [busy, false],
            [kept, true],
          ]);

          // Its last shell gone, the other moved project leaves as well.
          fakes.running?.splice(0);
          expect(inBusy.project).toBe(busy);
          const after = yield* workspaces.open({ name: "sparta" });
          expect(after.projects.map((project) => project.path)).toEqual([kept]);
          assert.deepStrictEqual(after.lastStarts, {});
        }),
      { registered: [], opened: [], titles: [], running: [], killed: [] },
    ),
  );

  it.effect("keeps an unreadable or invalid workspace listed and fails to open it", () =>
    withWorkspaces(
      {
        "broken.json": "not json",
        "future.json": '{"version":2}',
        "locked.json": '{"version":1}',
      },
      (dir) =>
        Effect.gen(function* () {
          const workspaces = yield* service;
          const fs = yield* FileSystem.FileSystem;
          yield* fs.chmod(`${dir}/locked.json`, 0o000);
          for (const name of ["broken", "future", "locked"]) {
            const error = yield* Effect.flip(workspaces.open({ name }));
            assert.strictEqual(error._tag, "WorkspaceInvalidError");
            assert.include(error.message, `Workspace "${name}" cannot be opened`);
          }
          assert.deepStrictEqual(yield* names, ["broken", "future", "locked"]);
          const missing = yield* Effect.flip(workspaces.open({ name: "gone" }));
          assert.strictEqual(missing._tag, "WorkspaceNotFoundError");
        }),
    ),
  );

  it.effect("reports a storage failure and leaves the list unchanged", () =>
    withWorkspaces({ "sparta.json": '{"version":1}' }, (dir) =>
      Effect.gen(function* () {
        const workspaces = yield* service;
        const fs = yield* FileSystem.FileSystem;
        yield* fs.chmod(dir, 0o555);
        const created = yield* Effect.flip(workspaces.create({ name: "athens" }));
        assert.strictEqual(created._tag, "WorkspaceStorageError");
        assert.include(created.message, "Could not create the workspace");
        const removed = yield* Effect.flip(workspaces.remove({ name: "sparta" }));
        assert.strictEqual(removed._tag, "WorkspaceStorageError");
        const tabs = { shellIds: ["a"], active: "a" };
        const saved = yield* Effect.flip(workspaces.saveTabs({ name: "sparta", tabs }));
        assert.strictEqual(saved._tag, "WorkspaceStorageError");
        assert.deepStrictEqual(yield* names, ["sparta"]);
      }),
    ),
  );

  it.effect("saves the open tabs with the workspace and opens with them", () =>
    withWorkspaces({ "sparta.json": '{"version":1,"folders":[]}' }, () =>
      Effect.gen(function* () {
        const workspaces = yield* service;
        const opened = yield* workspaces.open({ name: "sparta" });
        assert.deepStrictEqual(opened.tabs, { shellIds: [], active: null });

        const tabs = { shellIds: ["one", "two"], active: "two" };
        yield* workspaces.saveTabs({ name: "sparta", tabs });
        assert.deepStrictEqual((yield* workspaces.open({ name: "sparta" })).tabs, tabs);
        const missing = yield* Effect.flip(workspaces.saveTabs({ name: "gone", tabs }));
        assert.strictEqual(missing._tag, "WorkspaceNotFoundError");
      }),
    ),
  );

  it.effect("streams the list, then each change", () =>
    withWorkspaces({ "sparta.json": '{"version":1}' }, () =>
      Effect.gen(function* () {
        const workspaces = yield* service;
        // The first element is the snapshot, taken after subscribing.
        const subscribed = yield* Deferred.make<void>();
        const seen = yield* workspaces.streamChanges.pipe(
          Stream.tap(() => Deferred.succeed(subscribed, undefined)),
          Stream.map((list) => list.map((workspace) => workspace.name)),
          Stream.take(3),
          Stream.runCollect,
          Effect.forkScoped,
        );
        yield* Deferred.await(subscribed);
        yield* workspaces.create({ name: "athens" });
        yield* workspaces.remove({ name: "sparta" });
        assert.deepStrictEqual(Array.from(yield* Fiber.join(seen)), [
          ["sparta"],
          ["athens", "sparta"],
          ["athens"],
        ]);
      }),
    ),
  );

  it.effect("adds an existing folder once and a new one as a git repository", () =>
    withWorkspaces({ "sparta.json": '{"version":1}' }, (dir, fakes) =>
      Effect.gen(function* () {
        const workspaces = yield* service;
        const fs = yield* FileSystem.FileSystem;
        const plain = `${dir}/plain`;
        yield* fs.makeDirectory(plain);

        yield* workspaces.addProject({ mode: "import", name: "sparta", path: plain });
        yield* workspaces.addProject({ mode: "import", name: "sparta", path: `${plain}/` });
        const added = yield* workspaces.addProject({
          mode: "create",
          name: "sparta",
          parentPath: dir,
          folderName: "fresh",
        });

        assert.strictEqual(added.project, `${dir}/fresh`);
        const detail = added.workspace;
        expect(detail).toEqual({
          name: "sparta",
          projects: [
            { path: plain, isGitRepository: false, exists: true },
            { path: `${dir}/fresh`, isGitRepository: true, exists: true },
          ],
          lastStarts: {},
          tabs: { shellIds: [], active: null },
        });
        assert.isTrue(yield* fs.exists(`${dir}/fresh/.git`));
        assert.deepStrictEqual(fakes.registered, [plain, plain, `${dir}/fresh`]);
        assert.deepStrictEqual(yield* workspaces.open({ name: "sparta" }), detail);
      }),
    ),
  );

  it.effect("refuses a folder that is missing, a file, taken, or in a read-only parent", () =>
    withWorkspaces({ "sparta.json": '{"version":1}' }, (dir, fakes) =>
      Effect.gen(function* () {
        const workspaces = yield* service;
        const fs = yield* FileSystem.FileSystem;
        yield* fs.writeFileString(`${dir}/notes.txt`, "x");
        const locked = `${dir}/locked`;
        yield* fs.makeDirectory(locked);
        yield* fs.chmod(locked, 0o555);
        yield* Effect.addFinalizer(() => fs.chmod(locked, 0o755).pipe(Effect.ignore));
        const reason = (input: Parameters<typeof workspaces.addProject>[0]) =>
          Effect.flip(workspaces.addProject(input)).pipe(Effect.map((error) => error.message));

        const reasons = [
          yield* reason({ mode: "import", name: "sparta", path: `${dir}/gone` }),
          yield* reason({ mode: "import", name: "sparta", path: `${dir}/notes.txt` }),
          yield* reason({
            mode: "create",
            name: "sparta",
            parentPath: dir,
            folderName: "notes.txt",
          }),
          yield* reason({ mode: "create", name: "sparta", parentPath: locked, folderName: "app" }),
        ];

        expect(reasons).toEqual([
          `The folder does not exist: ${dir}/gone`,
          `This path is not a folder: ${dir}/notes.txt`,
          `Something named "notes.txt" already exists in ${dir}.`,
          `The server may not create a folder in ${locked}.`,
        ]);
        assert.deepStrictEqual(fakes.registered, []);
        assert.deepStrictEqual((yield* workspaces.open({ name: "sparta" })).projects, []);
      }),
    ),
  );

  it.effect("removes a folder it created when git init fails, so a retry can use the name", () =>
    withWorkspaces(
      { "sparta.json": '{"version":1}' },
      (dir, fakes) =>
        Effect.gen(function* () {
          const workspaces = yield* service;
          const fs = yield* FileSystem.FileSystem;
          const error = yield* Effect.flip(
            workspaces.addProject({
              mode: "create",
              name: "sparta",
              parentPath: dir,
              folderName: "app",
            }),
          );
          assert.strictEqual(error._tag, "WorkspaceProjectError");
          expect(error.message).toMatch(/^git init failed: /);
          assert.isFalse(yield* fs.exists(`${dir}/app`));
          assert.deepStrictEqual(fakes.registered, []);
          assert.deepStrictEqual((yield* workspaces.open({ name: "sparta" })).projects, []);
        }),
      { registered: [], opened: [], titles: [], initFails: true },
    ),
  );

  it.effect("starts a shell in a workspace project and remembers it while it exists", () =>
    withWorkspaces(
      { "sparta.json": '{"version":1}' },
      (dir, fakes) =>
        Effect.gen(function* () {
          const workspaces = yield* service;
          const fs = yield* FileSystem.FileSystem;
          const app = `${dir}/app`;
          yield* fs.makeDirectory(app);
          yield* workspaces.addProject({ mode: "import", name: "sparta", path: app });

          const shell = yield* workspaces.startShell({ name: "sparta", project: app, cols: 90 });
          assert.strictEqual(shell.cwd, app);
          assert.strictEqual(shell.title, "Shell 1");
          // No script asked for is a plain shell (ER-4).
          assert.deepStrictEqual(fakes.opened, [{ cwd: app, cols: 90 }]);
          assert.deepStrictEqual((yield* workspaces.open({ name: "sparta" })).lastStarts, {
            [app]: { worktree: { kind: "checkout" } },
          });

          const outside = yield* Effect.flip(
            workspaces.startShell({ name: "sparta", project: dir }),
          );
          expect(outside.message).toContain("not in the workspace");
          yield* fs.remove(app, { recursive: true });
          assert.deepStrictEqual(yield* workspaces.open({ name: "sparta" }), {
            name: "sparta",
            projects: [{ path: app, isGitRepository: false, exists: false }],
            lastStarts: {},
            tabs: { shellIds: [], active: null },
          });
          const gone = yield* Effect.flip(workspaces.startShell({ name: "sparta", project: app }));
          assert.strictEqual(gone.message, `The project's folder no longer exists: ${app}`);
          assert.strictEqual(fakes.opened.length, 1);
          yield* workspaces.create({ name: "athens" });
          yield* fs.makeDirectory(app);
          yield* workspaces.addProject({ mode: "import", name: "athens", path: app });
          yield* workspaces.startShell({ name: "athens", project: app });
          yield* workspaces.startShell({ name: "sparta", project: app });
          // Each workspace numbers its own shells in start order.
          assert.deepStrictEqual(fakes.titles, ["Shell 1", "Shell 1", "Shell 2"]);
        }),
      // The started shell is listed, so its project stays while its folder is gone.
      { registered: [], opened: [], titles: [], running: [] },
    ),
  );

  it.effect("does not remember a project whose shell failed to start", () =>
    withWorkspaces(
      { "sparta.json": '{"version":1}' },
      (dir, fakes) =>
        Effect.gen(function* () {
          const workspaces = yield* service;
          const fs = yield* FileSystem.FileSystem;
          yield* fs.makeDirectory(`${dir}/app`);
          yield* workspaces.addProject({ mode: "import", name: "sparta", path: `${dir}/app` });
          const error = yield* Effect.flip(
            workspaces.startShell({ name: "sparta", project: `${dir}/app` }),
          );
          assert.strictEqual(error._tag, "ShellLaunchError");
          assert.deepStrictEqual((yield* workspaces.open({ name: "sparta" })).lastStarts, {});
          // The failed start gives its number back.
          fakes.launchFails = false;
          const shell = yield* workspaces.startShell({ name: "sparta", project: `${dir}/app` });
          assert.strictEqual(shell.title, "Shell 1");
        }),
      { registered: [], opened: [], titles: [], launchFails: true },
    ),
  );

  const mockAgent: StartingScript = { id: "script-1", name: "mock agent", command: "mock --go" };
  const echoAgent: StartingScript = { id: "script-2", name: "echo agent", command: "echo hi" };

  it.effect("types the chosen starting script and remembers it per project and workspace", () =>
    withWorkspaces(
      { "sparta.json": '{"version":1}', "athens.json": '{"version":1}' },
      (dir, fakes) =>
        Effect.gen(function* () {
          const workspaces = yield* service;
          const fs = yield* FileSystem.FileSystem;
          const [app, api] = [`${dir}/app`, `${dir}/api`];
          for (const project of [app, api]) {
            yield* fs.makeDirectory(project);
            yield* workspaces.addProject({ mode: "import", name: "sparta", path: project });
          }
          yield* workspaces.addProject({ mode: "import", name: "athens", path: app });

          yield* workspaces.startShell({ name: "sparta", project: app, script: mockAgent });
          yield* workspaces.startShell({ name: "sparta", project: api });
          yield* workspaces.startShell({ name: "athens", project: app, script: echoAgent });

          assert.deepStrictEqual(
            fakes.opened.map((input) => input.script),
            ["mock --go", undefined, "echo hi"],
          );
          // Starting another project leaves this one's choice alone (EC-6).
          assert.deepStrictEqual((yield* workspaces.open({ name: "sparta" })).lastStarts, {
            [app]: { worktree: { kind: "checkout" }, script: "script-1" },
            [api]: { worktree: { kind: "checkout" } },
          });
          assert.deepStrictEqual((yield* workspaces.open({ name: "athens" })).lastStarts, {
            [app]: { worktree: { kind: "checkout" }, script: "script-2" },
          });
        }),
      { registered: [], opened: [], titles: [], scripts: [mockAgent, echoAgent] },
    ),
  );

  it.effect("refuses a starting script that is not in the list, naming it", () =>
    withWorkspaces(
      { "sparta.json": '{"version":1}' },
      (dir, fakes) =>
        Effect.gen(function* () {
          const workspaces = yield* service;
          const fs = yield* FileSystem.FileSystem;
          const app = `${dir}/app`;
          yield* fs.makeDirectory(app);
          yield* workspaces.addProject({ mode: "import", name: "sparta", path: app });

          const error = yield* Effect.flip(
            workspaces.startShell({ name: "sparta", project: app, script: echoAgent }),
          );

          assert.strictEqual(error._tag, "WorkspaceProjectError");
          expect(error.message).toContain('"echo agent"');
          assert.deepStrictEqual(fakes.opened, []);
          assert.deepStrictEqual((yield* workspaces.open({ name: "sparta" })).lastStarts, {});
          const shell = yield* workspaces.startShell({ name: "sparta", project: app });
          assert.strictEqual(shell.title, "Shell 1");
        }),
      { registered: [], opened: [], titles: [], scripts: [mockAgent] },
    ),
  );

  it.effect("starts the shell when its start cannot be remembered, and logs why", () => {
    const warnings: Array<string> = [];
    const logger = Logger.make(({ logLevel, message }) => {
      const [text] = Array.isArray(message) ? message : [message];
      if (logLevel === "Warn") warnings.push(String(text));
    });
    return withWorkspaces(
      { "sparta.json": '{"version":1}' },
      (dir, fakes) =>
        Effect.gen(function* () {
          const workspaces = yield* service;
          const fs = yield* FileSystem.FileSystem;
          const app = `${dir}/app`;
          yield* fs.makeDirectory(app);
          yield* workspaces.addProject({ mode: "import", name: "sparta", path: app });
          yield* fs.chmod(dir, 0o555);

          const shell = yield* workspaces.startShell({
            name: "sparta",
            project: app,
            script: mockAgent,
          });

          assert.strictEqual(shell.cwd, app);
          assert.deepStrictEqual(fakes.opened.map((input) => input.script), ["mock --go"]);
          expect(warnings).toContain("could not remember the workspace's last start");
        }),
      { registered: [], opened: [], titles: [], scripts: [mockAgent] },
    ).pipe(Effect.provide(Logger.layer([logger], { mergeWithExisting: false })));
  });

  // Git fixtures: a repository with two branches, a linked and a detached worktree, and the shells'
  // worktrees folder of the test home.
  const git = (cwd: string, ...args: string[]) =>
    NodeChildProcess.execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@t",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@t",
      },
    }).trim();

  const makeRepo = (dir: string, options: { readonly add: boolean } = { add: true }) =>
    Effect.gen(function* () {
      const workspaces = yield* service;
      const repo = `${dir}/repo`;
      NodeFS.mkdirSync(repo);
      git(repo, "init", "-q", "-b", "main");
      git(repo, "commit", "-q", "--allow-empty", "-m", "one");
      git(repo, "branch", "other");
      git(repo, "commit", "-q", "--allow-empty", "-m", "two");
      git(repo, "worktree", "add", "-q", "-b", "linked", `${dir}/linked`, "other");
      git(repo, "worktree", "add", "-q", "--detach", `${dir}/detached`, "other");
      if (options.add) yield* workspaces.addProject({ mode: "import", name: "sparta", path: repo });
      const { worktreesDir } = yield* ServerConfig.ServerConfig;
      return { repo, worktrees: `${worktreesDir}/repo` };
    });

  const gitState = (repo: string, worktrees: string) => ({
    branches: git(repo, "branch", "--format=%(refname:short)"),
    worktrees: git(repo, "worktree", "list", "--porcelain"),
    projects: NodeFS.existsSync(worktrees) ? NodeFS.readdirSync(worktrees) : [],
  });

  it.effect("offers a git project's worktrees, local branches and a free worktree name", () =>
    withWorkspaces({ "sparta.json": '{"version":1}' }, (dir) =>
      Effect.gen(function* () {
        const workspaces = yield* service;
        const { repo } = yield* makeRepo(dir);
        const other = git(repo, "rev-parse", "other");

        const offered = yield* workspaces.projectGit({ name: "sparta", project: repo });

        expect(offered).toEqual({
          hasCommit: true,
          currentBranch: "main",
          worktrees: [
            { path: repo, branch: "main", head: git(repo, "rev-parse", "HEAD"), isMain: true },
            { path: `${dir}/detached`, branch: null, head: other, isMain: false },
            { path: `${dir}/linked`, branch: "linked", head: other, isMain: false },
          ],
          branches: ["linked", "main", "other"],
          proposedWorktreeName: expect.stringMatching(/^probe-worktree-[0-9a-f]{6}$/),
          worktreesError: null,
          branchesError: null,
        });
        const outside = yield* Effect.flip(workspaces.projectGit({ name: "sparta", project: dir }));
        expect(outside.message).toContain("not in the workspace");
      }),
    ),
  );

  it.effect("reports a failed worktree or branch listing without hiding the other", () =>
    withWorkspaces({ "sparta.json": '{"version":1}' }, (dir, fakes) =>
      Effect.gen(function* () {
        const workspaces = yield* service;
        const { repo } = yield* makeRepo(dir);

        fakes.listingFails = "worktrees";
        const noWorktrees = yield* workspaces.projectGit({ name: "sparta", project: repo });
        fakes.listingFails = "branches";
        const noBranches = yield* workspaces.projectGit({ name: "sparta", project: repo });

        expect(noWorktrees).toMatchObject({
          worktrees: [],
          branches: ["linked", "main", "other"],
          currentBranch: "main",
          worktreesError: expect.stringContaining("git is unavailable"),
          branchesError: null,
        });
        expect(noBranches).toMatchObject({
          branches: [],
          branchesError: expect.stringContaining("git is unavailable"),
          worktreesError: null,
        });
        expect(noBranches.worktrees).toHaveLength(3);
      }),
    ),
  );

  it.effect("does not offer a new worktree in a repository with no commit", () =>
    withWorkspaces({ "sparta.json": '{"version":1}' }, (dir, fakes) =>
      Effect.gen(function* () {
        const workspaces = yield* service;
        const created = yield* workspaces.addProject({
          mode: "create",
          name: "sparta",
          parentPath: dir,
          folderName: "empty",
        });

        const offered = yield* workspaces.projectGit({ name: "sparta", project: created.project });
        const refused = yield* Effect.flip(
          workspaces.startShell({
            name: "sparta",
            project: created.project,
            worktree: {
              kind: "new",
              name: offered.proposedWorktreeName,
              startingPoint: { kind: "branch", name: "main" },
            },
          }),
        );
        yield* workspaces.startShell({ name: "sparta", project: created.project });

        assert.isFalse(offered.hasCommit);
        expect(refused.message).toContain("no commit");
        assert.deepStrictEqual(
          fakes.opened.map((input) => input.cwd),
          [created.project],
        );
      }),
    ),
  );

  it.effect("starts shells in new worktrees forked from a branch or a detached worktree", () =>
    withWorkspaces(
      { "sparta.json": '{"version":1}' },
      (dir, fakes) =>
        Effect.gen(function* () {
          const workspaces = yield* service;
          const { repo, worktrees } = yield* makeRepo(dir);
          const name = (yield* workspaces.projectGit({ name: "sparta", project: repo }))
            .proposedWorktreeName;
          const fromBranch = { kind: "branch" as const, name: "other" };

          const first = yield* workspaces.startShell({
            name: "sparta",
            project: repo,
            worktree: { kind: "new", name, startingPoint: fromBranch },
          });
          // A name taken since the dialog opened is replaced instead of reused (EC-1).
          const second = yield* workspaces.startShell({
            name: "sparta",
            project: repo,
            worktree: {
              kind: "new",
              name,
              startingPoint: { kind: "worktree", path: `${dir}/detached` },
            },
          });

          assert.strictEqual(first.cwd, `${worktrees}/${name}`);
          assert.strictEqual(git(first.cwd, "branch", "--show-current"), name);
          assert.strictEqual(git(repo, "rev-parse", name), git(repo, "rev-parse", "other"));
          const secondName = second.cwd.slice(worktrees.length + 1);
          expect(secondName).toMatch(/^probe-worktree-[0-9a-f]{6}$/);
          assert.notStrictEqual(secondName, name);
          assert.strictEqual(
            git(repo, "rev-parse", secondName),
            git(`${dir}/detached`, "rev-parse", "HEAD"),
          );
          assert.deepStrictEqual(fakes.worktrees, [first.cwd, second.cwd]);
          assert.deepStrictEqual((yield* workspaces.open({ name: "sparta" })).lastStarts, {
            [repo]: {
              worktree: {
                kind: "new",
                startingPoint: { kind: "worktree", path: `${dir}/detached` },
              },
            },
          });
        }),
      { registered: [], opened: [], titles: [], worktrees: [] },
    ),
  );

  it.effect("starts shells in the project's checkout or an existing worktree of it", () =>
    withWorkspaces(
      { "sparta.json": '{"version":1}' },
      (dir, fakes) =>
        Effect.gen(function* () {
          const workspaces = yield* service;
          const { repo } = yield* makeRepo(dir);
          const plain = `${dir}/plain`;
          yield* FileSystem.FileSystem.pipe(Effect.flatMap((fs) => fs.makeDirectory(plain)));
          yield* workspaces.addProject({ mode: "import", name: "sparta", path: plain });

          yield* workspaces.startShell({ name: "sparta", project: repo });
          yield* workspaces.startShell({
            name: "sparta",
            project: repo,
            worktree: { kind: "existing", path: `${dir}/linked` },
          });
          yield* workspaces.startShell({ name: "sparta", project: plain });
          const notOurs = yield* Effect.flip(
            workspaces.startShell({
              name: "sparta",
              project: repo,
              worktree: { kind: "existing", path: dir },
            }),
          );

          assert.deepStrictEqual(
            fakes.opened.map((input) => input.cwd),
            [repo, `${dir}/linked`, plain],
          );
          assert.deepStrictEqual(fakes.worktrees, [repo, `${dir}/linked`, undefined]);
          expect(notOurs.message).toContain("not a worktree of");
          // Each project keeps its own last start.
          assert.deepStrictEqual((yield* workspaces.open({ name: "sparta" })).lastStarts, {
            [repo]: { worktree: { kind: "existing", path: `${dir}/linked` } },
            [plain]: { worktree: { kind: "checkout" } },
          });
        }),
      { registered: [], opened: [], titles: [], worktrees: [] },
    ),
  );

  it.effect("leaves no branch, worktree or folder behind when a fork fails", () =>
    withWorkspaces({ "sparta.json": '{"version":1}' }, (dir, fakes) =>
      Effect.gen(function* () {
        const workspaces = yield* service;
        const { repo, worktrees } = yield* makeRepo(dir);
        const start = (startingPoint: { kind: "branch"; name: string }) =>
          workspaces.projectGit({ name: "sparta", project: repo }).pipe(
            Effect.flatMap((offered) =>
              workspaces.startShell({
                name: "sparta",
                project: repo,
                worktree: { kind: "new", name: offered.proposedWorktreeName, startingPoint },
              }),
            ),
            Effect.flip,
          );
        const before = gitState(repo, worktrees);

        const missing = yield* start({ kind: "branch", name: "gone" });
        // A file where the repository's worktrees folder belongs makes `worktree add` fail
        // after the branch was created.
        const { worktreesDir } = yield* ServerConfig.ServerConfig;
        NodeFS.mkdirSync(worktreesDir, { recursive: true });
        NodeFS.writeFileSync(worktrees, "in the way");
        const blocked = yield* start({ kind: "branch", name: "other" });
        NodeFS.rmSync(worktrees);

        expect(missing.message).toContain("gone");
        assert.strictEqual(blocked._tag, "WorkspaceProjectError");
        expect(blocked.message).toMatch(/^The worktree could not be created/);
        assert.deepStrictEqual(gitState(repo, worktrees), before);
        assert.deepStrictEqual(fakes.opened, []);
        assert.deepStrictEqual((yield* workspaces.open({ name: "sparta" })).lastStarts, {});
      }),
    ),
  );

  it.effect("keeps a created worktree when its shell fails to start", () =>
    withWorkspaces(
      { "sparta.json": '{"version":1}' },
      (dir) =>
        Effect.gen(function* () {
          const workspaces = yield* service;
          const { repo, worktrees } = yield* makeRepo(dir);
          const name = (yield* workspaces.projectGit({ name: "sparta", project: repo }))
            .proposedWorktreeName;

          const error = yield* Effect.flip(
            workspaces.startShell({
              name: "sparta",
              project: repo,
              worktree: { kind: "new", name, startingPoint: { kind: "branch", name: "main" } },
            }),
          );

          assert.strictEqual(error._tag, "ShellLaunchError");
          assert.isTrue(NodeFS.existsSync(`${worktrees}/${name}`));
          assert.strictEqual(git(repo, "rev-parse", name), git(repo, "rev-parse", "main"));
          const offered = yield* workspaces.projectGit({ name: "sparta", project: repo });
          expect(offered.worktrees.map((worktree) => worktree.path)).toContain(
            `${worktrees}/${name}`,
          );
          assert.deepStrictEqual((yield* workspaces.open({ name: "sparta" })).lastStarts, {});
        }),
      { registered: [], opened: [], titles: [], launchFails: true },
    ),
  );

  it.effect("reads a project remembered before worktrees as a start in its checkout", () =>
    withWorkspaces({}, (dir) =>
      Effect.gen(function* () {
        const workspaces = yield* service;
        const fs = yield* FileSystem.FileSystem;
        yield* fs.makeDirectory(`${dir}/app`);
        yield* fs.writeFileString(
          `${dir}/old.json`,
          JSON.stringify({
            version: 1,
            folders: [{ path: `${dir}/app` }],
            lastFolder: `${dir}/app`,
          }),
        );
        assert.deepStrictEqual((yield* workspaces.open({ name: "old" })).lastStarts, {
          [`${dir}/app`]: { worktree: { kind: "checkout" } },
        });
      }),
    ),
  );

  it.effect("reads the one remembered start a workspace kept before as its project's", () =>
    withWorkspaces({}, (dir) =>
      Effect.gen(function* () {
        const workspaces = yield* service;
        const fs = yield* FileSystem.FileSystem;
        for (const project of ["app", "api"]) yield* fs.makeDirectory(`${dir}/${project}`);
        yield* fs.writeFileString(
          `${dir}/old.json`,
          JSON.stringify({
            version: 1,
            projects: [{ path: `${dir}/app` }, { path: `${dir}/api` }],
            lastStart: { project: `${dir}/app`, worktree: { kind: "existing", path: dir } },
          }),
        );
        assert.deepStrictEqual((yield* workspaces.open({ name: "old" })).lastStarts, {
          [`${dir}/app`]: { worktree: { kind: "existing", path: dir } },
        });
      }),
    ),
  );

  it.effect("reads the folders and last start an older server saved as projects", () =>
    withWorkspaces({}, (dir) =>
      Effect.gen(function* () {
        const workspaces = yield* service;
        const fs = yield* FileSystem.FileSystem;
        yield* fs.makeDirectory(`${dir}/app`);
        yield* fs.writeFileString(
          `${dir}/old.json`,
          JSON.stringify({
            version: 1,
            folders: [{ path: `${dir}/app` }],
            lastStart: { folder: `${dir}/app`, worktree: { kind: "checkout" } },
          }),
        );
        const opened = yield* workspaces.open({ name: "old" });
        assert.deepStrictEqual(
          opened.projects.map((project) => project.path),
          [`${dir}/app`],
        );
        assert.deepStrictEqual(opened.lastStarts, {
          [`${dir}/app`]: { worktree: { kind: "checkout" } },
        });
        // The next save writes only the new keys.
        yield* workspaces.saveTabs({ name: "old", tabs: { shellIds: [], active: null } });
        const saved = JSON.parse(yield* fs.readFileString(`${dir}/old.json`));
        assert.deepStrictEqual(Object.keys(saved).toSorted(), [
          "lastStarts",
          "projects",
          "tabs",
          "version",
        ]);
        assert.deepStrictEqual(saved.lastStarts, {
          [`${dir}/app`]: { worktree: { kind: "checkout" } },
        });
      }),
    ),
  );

  it.effect("adds a worktree's repository as the project, and a subfolder as itself", () =>
    withWorkspaces({ "sparta.json": '{"version":1}' }, (dir) =>
      Effect.gen(function* () {
        const workspaces = yield* service;
        const { repo } = yield* makeRepo(dir, { add: false });
        NodeFS.mkdirSync(`${repo}/packages`);

        const linked = yield* workspaces.addProject({
          mode: "import",
          name: "sparta",
          path: `${dir}/linked`,
        });
        const primary = yield* workspaces.addProject({
          mode: "import",
          name: "sparta",
          path: repo,
        });
        const subfolder = yield* workspaces.addProject({
          mode: "import",
          name: "sparta",
          path: `${repo}/packages`,
        });

        expect(
          [linked, primary, subfolder].map((added) => [added.project, added.resolvedFrom]),
        ).toEqual([
          [repo, `${dir}/linked`],
          [repo, null],
          [`${repo}/packages`, null],
        ]);
        expect((yield* workspaces.open({ name: "sparta" })).projects.map((f) => f.path)).toEqual([
          repo,
          `${repo}/packages`,
        ]);
      }),
    ),
  );
});
