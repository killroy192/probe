import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { expect } from "vite-plus/test";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { ShellLaunchError, type ShellOpenInput, VcsProcessSpawnError } from "@t3tools/contracts";

import * as ServerConfig from "../config.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as Shells from "../terminal/Shells.ts";
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
  readonly opened: ShellOpenInput[];
  initFails?: boolean;
  launchFails?: boolean;
}

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
      open: (input) =>
        fakes.launchFails
          ? Effect.fail(new ShellLaunchError({ reason: "No agent command is configured." }))
          : Effect.sync(() => {
              fakes.opened.push(input);
              return {
                shellId: `shell-${fakes.opened.length}`,
                cwd: input.cwd,
                status: "running" as const,
                pid: 1,
                exitCode: null,
                exitSignal: null,
                label: "shell",
                updatedAt: "now",
              };
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
    layerRegistry,
    WorkspacePaths.layer,
  );

const withWorkspaces = <A, E>(
  seeds: Readonly<Record<string, string>>,
  body: (dir: string, fakes: Fakes) => Effect.Effect<A, E, Env>,
  fakes: Fakes = { registered: [], opened: [] },
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
          folders: [],
          lastFolder: null,
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
        assert.deepStrictEqual(yield* names, ["sparta"]);
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

        yield* workspaces.addFolder({ mode: "import", name: "sparta", path: plain });
        yield* workspaces.addFolder({ mode: "import", name: "sparta", path: `${plain}/` });
        const added = yield* workspaces.addFolder({
          mode: "create",
          name: "sparta",
          parentPath: dir,
          folderName: "fresh",
        });

        assert.strictEqual(added.folder, `${dir}/fresh`);
        const detail = added.workspace;
        assert.deepStrictEqual(detail, {
          name: "sparta",
          folders: [
            { path: plain, isGitRepository: false, exists: true },
            { path: `${dir}/fresh`, isGitRepository: true, exists: true },
          ],
          lastFolder: null,
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
        const reason = (input: Parameters<typeof workspaces.addFolder>[0]) =>
          Effect.flip(workspaces.addFolder(input)).pipe(Effect.map((error) => error.message));

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
        assert.deepStrictEqual((yield* workspaces.open({ name: "sparta" })).folders, []);
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
            workspaces.addFolder({
              mode: "create",
              name: "sparta",
              parentPath: dir,
              folderName: "app",
            }),
          );
          assert.strictEqual(error._tag, "WorkspaceFolderError");
          expect(error.message).toMatch(/^git init failed: /);
          assert.isFalse(yield* fs.exists(`${dir}/app`));
          assert.deepStrictEqual(fakes.registered, []);
          assert.deepStrictEqual((yield* workspaces.open({ name: "sparta" })).folders, []);
        }),
      { registered: [], opened: [], initFails: true },
    ),
  );

  it.effect("starts an agent shell in a workspace folder and remembers it while it exists", () =>
    withWorkspaces({ "sparta.json": '{"version":1}' }, (dir, fakes) =>
      Effect.gen(function* () {
        const workspaces = yield* service;
        const fs = yield* FileSystem.FileSystem;
        const app = `${dir}/app`;
        yield* fs.makeDirectory(app);
        yield* workspaces.addFolder({ mode: "import", name: "sparta", path: app });

        const shell = yield* workspaces.startShell({ name: "sparta", folder: app, cols: 90 });
        assert.strictEqual(shell.cwd, app);
        assert.deepStrictEqual(fakes.opened, [{ cwd: app, agent: true, cols: 90 }]);
        assert.strictEqual((yield* workspaces.open({ name: "sparta" })).lastFolder, app);

        const outside = yield* Effect.flip(workspaces.startShell({ name: "sparta", folder: dir }));
        expect(outside.message).toContain("not in the workspace");
        yield* fs.remove(app, { recursive: true });
        assert.deepStrictEqual(yield* workspaces.open({ name: "sparta" }), {
          name: "sparta",
          folders: [{ path: app, isGitRepository: false, exists: false }],
          lastFolder: null,
        });
        const gone = yield* Effect.flip(workspaces.startShell({ name: "sparta", folder: app }));
        assert.strictEqual(gone.message, `The folder no longer exists: ${app}`);
        assert.strictEqual(fakes.opened.length, 1);
      }),
    ),
  );

  it.effect("does not remember a folder whose shell failed to start", () =>
    withWorkspaces(
      { "sparta.json": '{"version":1}' },
      (dir) =>
        Effect.gen(function* () {
          const workspaces = yield* service;
          const fs = yield* FileSystem.FileSystem;
          yield* fs.makeDirectory(`${dir}/app`);
          yield* workspaces.addFolder({ mode: "import", name: "sparta", path: `${dir}/app` });
          const error = yield* Effect.flip(
            workspaces.startShell({ name: "sparta", folder: `${dir}/app` }),
          );
          assert.strictEqual(error._tag, "ShellLaunchError");
          assert.strictEqual((yield* workspaces.open({ name: "sparta" })).lastFolder, null);
        }),
      { registered: [], opened: [], launchFails: true },
    ),
  );
});
