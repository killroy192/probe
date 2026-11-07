import {
  CommandId,
  ProjectId,
  type ShellSummary,
  type WorkspaceAddProjectInput,
  type WorkspaceAddProjectResult,
  type WorkspaceRemoveProjectInput,
  type WorkspaceDetail,
  WorkspaceProjectError,
  type WorkspaceProjectGit,
  type WorkspaceProjectGitInput,
  type WorkspaceInput,
  WorkspaceLastStart,
  type WorkspaceSaveTabsInput,
  WorkspaceTabs,
  type WorkspaceWorktreeChoice,
  WorkspaceInvalidError,
  type WorkspaceStartShellInput,
  WorkspaceNameTakenError,
  WorkspaceNotFoundError,
  WorkspaceStorageError,
  type WorkspaceSummary,
  workspaceNameProblem,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import type * as PlatformError from "effect/PlatformError";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";

import * as ServerConfig from "../config.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as Shells from "../terminal/Shells.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProvisioningService from "../vcs/VcsProvisioningService.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";

const FILE_SUFFIX = ".json";
const NO_TABS: WorkspaceTabs = { shellIds: [], active: null };

// The name lives in the file name; the content is versioned so story 7 can add the layout.
// Projects arrived after version 1 shipped, so every field stays optional.
const SavedWorkspaceFile = Schema.Struct({
  version: Schema.Literal(1),
  projects: Schema.optional(Schema.Array(Schema.Struct({ path: Schema.String }))),
  lastStart: Schema.optional(Schema.NullOr(WorkspaceLastStart)),
  tabs: Schema.optional(WorkspaceTabs),
});
type SavedWorkspaceFile = typeof SavedWorkspaceFile.Type;
const encodeSavedWorkspaceFile = Schema.encodeSync(Schema.fromJsonString(SavedWorkspaceFile));

// What older servers wrote: `folders` for the projects, `lastStart.folder`, and `lastFolder`, which
// files written before worktrees use for the last start. Reading maps them; writing never emits them.
const DiskWorkspaceFile = Schema.Struct({
  ...SavedWorkspaceFile.fields,
  folders: Schema.optional(Schema.Array(Schema.Struct({ path: Schema.String }))),
  lastFolder: Schema.optional(Schema.NullOr(Schema.String)),
  lastStart: Schema.optional(
    Schema.NullOr(
      Schema.Union([
        WorkspaceLastStart,
        Schema.Struct({ folder: Schema.String, worktree: WorkspaceLastStart.fields.worktree }),
      ]),
    ),
  ),
});
const decodeDiskWorkspaceFile = Schema.decodeUnknownExit(Schema.fromJsonString(DiskWorkspaceFile));

const fromDisk = (disk: typeof DiskWorkspaceFile.Type): SavedWorkspaceFile => {
  const { folders, lastFolder, lastStart, projects, ...rest } = disk;
  const start =
    lastStart != null
      ? "folder" in lastStart
        ? { project: lastStart.folder, worktree: lastStart.worktree }
        : lastStart
      : lastFolder == null
        ? null
        : { project: lastFolder, worktree: { kind: "checkout" as const } };
  const saved = projects ?? folders;
  return {
    ...rest,
    ...(saved === undefined ? {} : { projects: saved }),
    ...(start === null ? {} : { lastStart: start }),
  };
};

interface PublishedWorkspaces {
  readonly seq: number;
  readonly workspaces: ReadonlyArray<WorkspaceSummary>;
}

/** Workspaces saved as one file each in the server's workspaces folder, named after the workspace. */
export class SavedWorkspaces extends Context.Service<
  SavedWorkspaces,
  {
    readonly list: Effect.Effect<ReadonlyArray<WorkspaceSummary>, WorkspaceStorageError>;
    readonly create: (
      input: WorkspaceInput,
    ) => Effect.Effect<WorkspaceSummary, WorkspaceNameTakenError | WorkspaceStorageError>;
    readonly remove: (
      input: WorkspaceInput,
    ) => Effect.Effect<void, WorkspaceNotFoundError | WorkspaceStorageError>;
    /** Reads the workspace's file; an unreadable or invalid file fails and stays listed. */
    readonly open: (
      input: WorkspaceInput,
    ) => Effect.Effect<WorkspaceDetail, WorkspaceNotFoundError | WorkspaceInvalidError>;
    /** Imports an existing folder, or creates one with a new git repository, as a project. */
    readonly addProject: (
      input: WorkspaceAddProjectInput,
    ) => Effect.Effect<
      WorkspaceAddProjectResult,
      WorkspaceNotFoundError | WorkspaceInvalidError | WorkspaceProjectError | WorkspaceStorageError
    >;
    /**
     * Removes a project and kills every shell started in it, also one another workspace with the
     * same project started. The folder stays on disk.
     */
    readonly removeProject: (
      input: WorkspaceRemoveProjectInput,
    ) => Effect.Effect<
      WorkspaceDetail,
      WorkspaceNotFoundError | WorkspaceInvalidError | WorkspaceProjectError | WorkspaceStorageError
    >;
    /** What a git project offers for a start: its worktrees, branches and a new worktree name. */
    readonly projectGit: (
      input: WorkspaceProjectGitInput,
    ) => Effect.Effect<
      WorkspaceProjectGit,
      WorkspaceNotFoundError | WorkspaceInvalidError | WorkspaceProjectError
    >;
    /** Saves which shells the workspace shows as tabs, and the selected one. */
    readonly saveTabs: (
      input: WorkspaceSaveTabsInput,
    ) => Effect.Effect<
      void,
      WorkspaceNotFoundError | WorkspaceInvalidError | WorkspaceStorageError
    >;
    /**
     * Starts an agent shell in a project's checkout, a worktree of it, or a new worktree, and
     * remembers that choice. A new worktree that fails to be created leaves nothing behind.
     */
    readonly startShell: (
      input: WorkspaceStartShellInput,
    ) => Effect.Effect<
      ShellSummary,
      | WorkspaceNotFoundError
      | WorkspaceInvalidError
      | WorkspaceProjectError
      | Effect.Error<ReturnType<Shells.Shells["Service"]["open"]>>
    >;
    /** Subscribes before reading, so no change made while connecting is lost. */
    readonly streamChanges: Stream.Stream<ReadonlyArray<WorkspaceSummary>>;
  }
>()("t3/savedWorkspaces/SavedWorkspaces") {}

const nameFromFileName = (entry: string) => {
  if (!entry.endsWith(FILE_SUFFIX)) return null;
  const name = entry.slice(0, -FILE_SUFFIX.length);
  return name.trim() === name && workspaceNameProblem(name) === null ? name : null;
};

const storageReason = (error: PlatformError.PlatformError) =>
  error.reason._tag === "PermissionDenied"
    ? "the server may not change its workspaces folder."
    : error.message;

const sameName = (left: string, right: string) =>
  left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;

const pathReason = (error: { readonly _tag: string; readonly message: string }, path: string) => {
  switch (error._tag) {
    case "WorkspaceRootNotExistsError":
      return `The folder does not exist: ${path}`;
    case "WorkspaceRootNotDirectoryError":
      return `This path is not a folder: ${path}`;
    default:
      return error.message;
  }
};

const make = Effect.gen(function* () {
  const { workspacesDir, worktreesDir } = yield* ServerConfig.ServerConfig;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const projects = yield* ProjectService.ProjectService;
  const vcs = yield* VcsDriverRegistry.VcsDriverRegistry;
  const provisioning = yield* VcsProvisioningService.VcsProvisioningService;
  const workspacePaths = yield* WorkspacePaths.WorkspacePaths;
  const shells = yield* Shells.Shells;
  const randomId = (yield* Crypto.Crypto).randomUUIDv4().pipe(Effect.orDie);
  const shellNumbers = new Map<string, number>();
  const fileOf = (name: string) => path.join(workspacesDir, `${name}${FILE_SUFFIX}`);

  const changes = yield* PubSub.sliding<PublishedWorkspaces>(1);
  const published = yield* Ref.make<PublishedWorkspaces>({ seq: 0, workspaces: [] });
  // Serializes read/compare/publish and the writes, so a name check and its write see one folder.
  const lock = yield* Semaphore.make(1);
  const watcherScope = yield* Scope.make("sequential");
  yield* Effect.addFinalizer(() => Scope.close(watcherScope, Exit.void));

  const readList = fs.readDirectory(workspacesDir).pipe(
    Effect.map((entries) =>
      entries
        .flatMap((entry) => {
          const name = nameFromFileName(entry);
          return name === null ? [] : [{ name }];
        })
        .toSorted((left, right) => left.name.localeCompare(right.name)),
    ),
    Effect.mapError(
      (error) => new WorkspaceStorageError({ operation: "list", reason: storageReason(error) }),
    ),
  );

  const publish = Effect.fnUntraced(function* (workspaces: ReadonlyArray<WorkspaceSummary>) {
    const [changed, next] = yield* Ref.modify(
      published,
      (previous): readonly [readonly [boolean, PublishedWorkspaces], PublishedWorkspaces] => {
        if (Equal.equals(previous.workspaces, workspaces)) return [[false, previous], previous];
        const updated = { seq: previous.seq + 1, workspaces };
        return [[true, updated], updated];
      },
    );
    if (changed) yield* PubSub.publish(changes, next);
    return next;
  });

  // Unlocked read-and-publish; callers hold the lock.
  const refreshUnlocked = readList.pipe(Effect.flatMap(publish));
  const refresh = lock.withPermits(1)(refreshUnlocked);
  // A failed read keeps the last list, so a subscriber never sees workspaces vanish on an I/O error.
  const refreshOrLast = refresh.pipe(
    Effect.catch((error) =>
      Effect.logWarning("could not read the workspaces folder", { reason: error.reason }).pipe(
        Effect.andThen(Ref.get(published)),
      ),
    ),
  );

  yield* fs
    .makeDirectory(workspacesDir, { recursive: true })
    .pipe(Effect.ignoreCause({ log: true }));
  yield* refreshOrLast;
  // A save emits several events, and fs.watch can fire before content is flushed.
  yield* Stream.runForEach(
    fs.watch(workspacesDir).pipe(Stream.debounce(Duration.millis(100))),
    () => refreshOrLast,
  ).pipe(Effect.ignoreCause({ log: true }), Effect.forkIn(watcherScope), Effect.asVoid);

  const create = Effect.fn("SavedWorkspaces.create")(function* (input: WorkspaceInput) {
    const existing = yield* readList.pipe(
      Effect.mapError(
        (error) => new WorkspaceStorageError({ operation: "create", reason: error.reason }),
      ),
    );
    if (existing.some((workspace) => sameName(workspace.name, input.name))) {
      return yield* new WorkspaceNameTakenError({ name: input.name });
    }
    // Exclusive create: a racing writer or a file the list skipped is never overwritten.
    yield* fs
      .writeFileString(fileOf(input.name), encodeSavedWorkspaceFile({ version: 1 }), {
        flag: "wx",
      })
      .pipe(
        Effect.mapError((error) =>
          error.reason._tag === "AlreadyExists"
            ? new WorkspaceNameTakenError({ name: input.name })
            : new WorkspaceStorageError({ operation: "create", reason: storageReason(error) }),
        ),
      );
    yield* refreshUnlocked.pipe(Effect.ignore);
    return { name: input.name };
  }, lock.withPermits(1));

  const removeFile = Effect.fn("SavedWorkspaces.removeFile")(function* (name: string) {
    // An unreadable file still goes; it just has no projects whose shells could be ended.
    const projects = yield* readFile(name).pipe(
      Effect.map((file) => (file.projects ?? []).map((project) => project.path)),
      Effect.orElseSucceed((): ReadonlyArray<string> => []),
    );
    // Only the workspace's own file goes; projects the workspace refers to are never touched.
    yield* fs
      .remove(fileOf(name))
      .pipe(
        Effect.mapError((error) =>
          error.reason._tag === "NotFound"
            ? new WorkspaceNotFoundError({ name })
            : new WorkspaceStorageError({ operation: "remove", reason: storageReason(error) }),
        ),
      );
    yield* refreshUnlocked.pipe(Effect.ignore);
    return projects;
  }, lock.withPermits(1));

  // Starts and removals of one workspace take turns, so a shell started while its workspace is
  // removed is either killed with the others or never started.
  const startLocks = new Map<string, Semaphore.Semaphore>();
  const startLockOf = (name: string) => {
    const key = name.toLowerCase();
    const existing = startLocks.get(key);
    if (existing !== undefined) return existing;
    const created = Semaphore.makeUnsafe(1);
    startLocks.set(key, created);
    return created;
  };

  /**
   * Removes a workspace and kills every shell started in one of its projects, also one that
   * another workspace with the same project started.
   */
  const remove = Effect.fn("SavedWorkspaces.remove")(function* (input: WorkspaceInput) {
    yield* startLockOf(input.name).withPermits(1)(
      removeFile(input.name).pipe(Effect.flatMap((projects) => killShellsIn(new Set(projects)))),
    );
  });

  const dropProject = Effect.fn("SavedWorkspaces.dropProject")(function* (
    input: WorkspaceRemoveProjectInput,
  ) {
    const { lastStart, ...file } = yield* readFile(input.name);
    const projects = file.projects ?? [];
    if (!projects.some((saved) => saved.path === input.project)) {
      return yield* projectError(`This project is not in the workspace: ${input.project}`);
    }
    // A remembered start in the removed project would preselect a project that is gone.
    const next: SavedWorkspaceFile = {
      ...file,
      projects: projects.filter((saved) => saved.path !== input.project),
      ...(lastStart == null || lastStart.project === input.project ? {} : { lastStart }),
    };
    yield* writeFile(input.name, next);
    return yield* toDetail(input.name, next);
  }, lock.withPermits(1));

  const removeProject = Effect.fn("SavedWorkspaces.removeProject")(function* (
    input: WorkspaceRemoveProjectInput,
  ) {
    return yield* startLockOf(input.name).withPermits(1)(
      dropProject(input).pipe(Effect.tap(() => killShellsIn(new Set([input.project])))),
    );
  });

  const killShellsIn = Effect.fn("SavedWorkspaces.killShellsIn")(function* (
    projects: ReadonlySet<string>,
  ) {
    const running = yield* shells.list;
    yield* Effect.forEach(
      running.filter((shell) => projects.has(shell.project ?? shell.cwd)),
      // The workspace or project is gone either way; a shell that would not die is only logged.
      (shell) =>
        shells.kill(shell.shellId).pipe(
          Effect.catch((error) =>
            Effect.logWarning("could not kill a shell of a removed workspace or project", {
              shellId: shell.shellId,
              reason: error.message,
            }),
          ),
        ),
      { discard: true },
    );
  });

  const readFile = Effect.fn("SavedWorkspaces.readFile")(function* (name: string) {
    const raw = yield* fs
      .readFileString(fileOf(name))
      .pipe(
        Effect.mapError((error) =>
          error.reason._tag === "NotFound"
            ? new WorkspaceNotFoundError({ name })
            : new WorkspaceInvalidError({ name, reason: "its file cannot be read." }),
        ),
      );
    const decoded = decodeDiskWorkspaceFile(raw);
    if (Exit.isFailure(decoded)) {
      return yield* new WorkspaceInvalidError({
        name,
        reason: "its file is not a valid workspace file.",
      });
    }
    return fromDisk(decoded.value);
  });

  // Rewrites the whole file; the caller holds the lock and has just read it, so it still exists.
  const writeFile = (name: string, file: SavedWorkspaceFile) =>
    writeFileStringAtomically({
      filePath: fileOf(name),
      contents: encodeSavedWorkspaceFile(file),
    }).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.mapError(
        (error) => new WorkspaceStorageError({ operation: "update", reason: storageReason(error) }),
      ),
    );

  const isDirectory = (folder: string) =>
    fs.stat(folder).pipe(
      Effect.map((info) => info.type === "Directory"),
      Effect.orElseSucceed(() => false),
    );

  const toDetail = Effect.fn("SavedWorkspaces.toDetail")(function* (
    name: string,
    file: SavedWorkspaceFile,
  ) {
    const projects = yield* Effect.forEach(
      file.projects ?? [],
      Effect.fnUntraced(function* ({ path: project }) {
        if (!(yield* isDirectory(project))) {
          return { path: project, isGitRepository: false, exists: false };
        }
        const isGitRepository = yield* vcs.detect({ cwd: project }).pipe(
          Effect.map((handle) => handle !== null),
          Effect.orElseSucceed(() => false),
        );
        return { path: project, isGitRepository, exists: true };
      }),
      { concurrency: "unbounded" },
    );
    const remembered = file.lastStart ?? null;
    // A remembered project that left the workspace or the disk is not offered again.
    const lastStart = projects.some(
      (project) => project.path === remembered?.project && project.exists,
    )
      ? remembered
      : null;
    const tabs = file.tabs ?? NO_TABS;
    return { name, projects, lastStart, tabs } satisfies WorkspaceDetail;
  });

  /**
   * Reads the workspace's file. A project whose folder is gone and that no listed shell belongs to
   * leaves the workspace; one with shells stays, marked, until they are removed.
   */
  const open = Effect.fn("SavedWorkspaces.open")(function* (input: WorkspaceInput) {
    const file = yield* readFile(input.name);
    const detail = yield* toDetail(input.name, file);
    const gone = detail.projects
      .filter((project) => !project.exists)
      .map((project) => project.path);
    if (gone.length === 0) return detail;
    const listed = yield* shells.list;
    const empty = new Set(
      gone.filter((project) => !listed.some((shell) => (shell.project ?? shell.cwd) === project)),
    );
    if (empty.size === 0) return detail;
    const { lastStart, ...rest } = file;
    const next: SavedWorkspaceFile = {
      ...rest,
      projects: (file.projects ?? []).filter((saved) => !empty.has(saved.path)),
      ...(lastStart == null || empty.has(lastStart.project) ? {} : { lastStart }),
    };
    return yield* writeFile(input.name, next).pipe(
      Effect.tap(() =>
        Effect.logInfo("removed projects whose folders are gone", {
          workspace: input.name,
          projects: [...empty],
        }),
      ),
      Effect.andThen(toDetail(input.name, next)),
      // Unsaved, the projects stay listed as moved; the next open tries again.
      Effect.catch((error) =>
        Effect.logWarning("could not remove projects whose folders are gone", {
          workspace: input.name,
          reason: error.message,
        }).pipe(Effect.as(detail)),
      ),
    );
  }, lock.withPermits(1));

  const saveTabs = Effect.fn("SavedWorkspaces.saveTabs")(function* (input: WorkspaceSaveTabsInput) {
    const file = yield* readFile(input.name);
    yield* writeFile(input.name, { ...file, tabs: input.tabs });
  }, lock.withPermits(1));

  const projectError = (reason: string) => new WorkspaceProjectError({ reason });

  const normalizeExisting = (folder: string) =>
    workspacePaths
      .normalizeWorkspaceRoot(folder, { createIfMissing: false })
      .pipe(Effect.mapError((error) => projectError(pathReason(error, folder))));

  // A linked worktree is one checkout of a repository; the workspace holds the repository itself.
  const repositoryOf = Effect.fnUntraced(function* (folder: string) {
    // Git lists the repository's primary worktree first; a subfolder of a repository is kept.
    const worktrees = yield* listWorktrees(folder).pipe(Effect.orElseSucceed(() => []));
    const isLinked = worktrees.findIndex((worktree) => worktree.isMain) > 0;
    const primary = worktrees[0];
    return isLinked && primary !== undefined && (yield* isDirectory(primary.path))
      ? primary.path
      : folder;
  });

  const createFolder = Effect.fn("SavedWorkspaces.createFolder")(function* (
    parentPath: string,
    folderName: string,
  ) {
    const parent = yield* normalizeExisting(parentPath);
    const target = path.join(parent, folderName);
    yield* fs
      .makeDirectory(target)
      .pipe(
        Effect.mapError((error) =>
          projectError(
            error.reason._tag === "AlreadyExists"
              ? `Something named "${folderName}" already exists in ${parent}.`
              : error.reason._tag === "PermissionDenied"
                ? `The server may not create a folder in ${parent}.`
                : `The folder could not be created: ${error.message}`,
          ),
        ),
      );
    return target;
  });

  const removeCreated = (target: string) =>
    fs.remove(target, { recursive: true }).pipe(Effect.ignore({ log: true }));

  const register = Effect.fn("SavedWorkspaces.register")(
    function* (project: string) {
      const id = yield* randomId;
      yield* projects.bootstrap({
        commandId: CommandId.make(`workspace-project:${id}`),
        projectId: ProjectId.make(id),
        title: path.basename(project) || project,
        workspaceRoot: project,
        createWorkspaceRootIfMissing: false,
      });
    },
    Effect.mapError((error) =>
      projectError(`The folder could not be registered as a project: ${error.message}`),
    ),
  );

  const addProject = Effect.fn("SavedWorkspaces.addProject")(function* (
    input: WorkspaceAddProjectInput,
  ) {
    const file = yield* readFile(input.name);
    let project: string;
    let resolvedFrom: string | null = null;
    if (input.mode === "import") {
      const imported = yield* normalizeExisting(input.path);
      project = yield* repositoryOf(imported);
      if (project !== imported) resolvedFrom = imported;
      yield* register(project);
    } else {
      const target = yield* createFolder(input.parentPath, input.folderName);
      // A half-made folder is removed, so a retry with the same name works (ER-3).
      yield* provisioning.initRepository({ cwd: target }).pipe(
        Effect.mapError((error) => projectError(`git init failed: ${error.message}`)),
        Effect.andThen(register(target)),
        Effect.tapError(() => removeCreated(target)),
      );
      project = target;
    }
    const projects = file.projects ?? [];
    const next = projects.some((existing) => existing.path === project)
      ? file
      : { ...file, projects: [...projects, { path: project }] };
    if (next !== file) yield* writeFile(input.name, next);
    return { workspace: yield* toDetail(input.name, next), project, resolvedFrom };
  }, lock.withPermits(1));

  const rememberStart = Effect.fn("SavedWorkspaces.rememberStart")(function* (
    name: string,
    lastStart: WorkspaceLastStart,
  ) {
    const file = yield* readFile(name);
    yield* writeFile(name, { ...file, lastStart });
  }, lock.withPermits(1));

  const requireProject = Effect.fn("SavedWorkspaces.requireProject")(function* (
    name: string,
    project: string,
  ) {
    const file = yield* readFile(name);
    if (!(file.projects ?? []).some((saved) => saved.path === project)) {
      return yield* projectError(`This project is not in the workspace: ${project}`);
    }
    if (!(yield* isDirectory(project))) {
      return yield* projectError(`The project's folder no longer exists: ${project}`);
    }
  });

  const gitReason = (error: { readonly detail: string }) => error.detail;
  const realPath = (folder: string) => fs.realPath(folder).pipe(Effect.orElseSucceed(() => folder));
  const branchExists = (project: string, branch: string) =>
    git
      .execute({
        operation: "SavedWorkspaces.branchExists",
        cwd: project,
        args: ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
        allowNonZeroExit: true,
      })
      .pipe(
        Effect.map((result) => result.exitCode === 0),
        Effect.orElseSucceed(() => true),
      );
  const worktreeTarget = (project: string, name: string) =>
    path.join(worktreesDir, path.basename(path.resolve(project)), name);

  // A name in use as a branch or a folder is never reused (EC-1).
  const isNameFree = Effect.fnUntraced(function* (project: string, name: string) {
    if (yield* branchExists(project, name)) return false;
    return !(yield* fs
      .exists(worktreeTarget(project, name))
      .pipe(Effect.orElseSucceed(() => false)));
  });

  const drawName = Effect.fnUntraced(function* (project: string) {
    for (let attempt = 0; attempt < 16; attempt++) {
      const name = `probe-worktree-${(yield* randomId).replaceAll("-", "").slice(0, 6)}`;
      if (yield* isNameFree(project, name)) return name;
    }
    return yield* projectError("No free worktree name was found. Try again.");
  });

  // The folder's own checkout is the worktree at its path; a folder may itself be a linked one.
  const listWorktrees = Effect.fnUntraced(function* (project: string) {
    const own = yield* realPath(project);
    const worktrees = yield* git.listWorktrees(project);
    return yield* Effect.forEach(worktrees, (worktree) =>
      realPath(worktree.path).pipe(Effect.map((real) => ({ ...worktree, isMain: real === own }))),
    );
  });

  const projectGit = Effect.fn("SavedWorkspaces.projectGit")(function* (
    input: WorkspaceProjectGitInput,
  ) {
    yield* requireProject(input.name, input.project);
    const [worktrees, branches, hasCommit] = yield* Effect.all(
      [
        Effect.result(listWorktrees(input.project)),
        Effect.result(git.listLocalBranchNames(input.project)),
        git.hasCommit(input.project).pipe(Effect.orElseSucceed(() => false)),
      ],
      { concurrency: "unbounded" },
    );
    const currentBranch =
      worktrees._tag === "Success"
        ? (worktrees.success.find((worktree) => worktree.isMain)?.branch ?? null)
        : yield* git
            .execute({
              operation: "SavedWorkspaces.currentBranch",
              cwd: input.project,
              args: ["branch", "--show-current"],
            })
            .pipe(
              Effect.map((result) => result.stdout.trim() || null),
              Effect.orElseSucceed(() => null),
            );
    return {
      hasCommit,
      currentBranch,
      worktrees: worktrees._tag === "Success" ? worktrees.success : [],
      branches:
        branches._tag === "Success" ? branches.success.toSorted((a, b) => a.localeCompare(b)) : [],
      proposedWorktreeName: yield* drawName(input.project),
      worktreesError: worktrees._tag === "Failure" ? gitReason(worktrees.failure) : null,
      branchesError: branches._tag === "Failure" ? gitReason(branches.failure) : null,
    } satisfies WorkspaceProjectGit;
  });

  // Removes only what this attempt made: its registered worktree, its folder and its branch.
  const rollbackFork = Effect.fnUntraced(function* (
    project: string,
    target: string,
    branch: string,
    madeParent: boolean,
  ) {
    const registered = yield* listWorktrees(project).pipe(
      Effect.map((worktrees) => worktrees.some((worktree) => worktree.path === target)),
      Effect.orElseSucceed(() => false),
    );
    if (registered) {
      yield* git
        .removeWorktree({ cwd: project, path: target, force: true })
        .pipe(Effect.ignore({ log: true }));
    }
    yield* fs.remove(target, { recursive: true }).pipe(Effect.ignore);
    if (yield* branchExists(project, branch)) {
      yield* git
        .deleteLocalBranch({ cwd: project, refName: branch, force: true })
        .pipe(Effect.ignore({ log: true }));
    }
    if (madeParent) {
      const parent = path.dirname(target);
      const left = yield* fs.readDirectory(parent).pipe(Effect.orElseSucceed(() => ["?"]));
      if (left.length === 0) yield* fs.remove(parent).pipe(Effect.ignore);
    }
  });

  const startingCommit = Effect.fnUntraced(function* (
    project: string,
    startingPoint: Extract<WorkspaceWorktreeChoice, { kind: "new" }>["startingPoint"],
  ) {
    if (startingPoint.kind === "branch") {
      return yield* git
        .resolveCommit({ cwd: project, revision: `refs/heads/${startingPoint.name}` })
        .pipe(
          Effect.map((resolved) => resolved.commitSha),
          Effect.mapError(() =>
            projectError(`The starting branch "${startingPoint.name}" no longer exists.`),
          ),
        );
    }
    const worktrees = yield* listWorktrees(project).pipe(
      Effect.mapError((error) =>
        projectError(`The worktrees could not be listed: ${gitReason(error)}`),
      ),
    );
    const source = worktrees.find((worktree) => worktree.path === startingPoint.path);
    if (source === undefined) {
      return yield* projectError(`The starting worktree no longer exists: ${startingPoint.path}`);
    }
    return source.head;
  });

  // Serializes forks, so two starts never draw or check the same name at once (EC-9).
  const forkLock = yield* Semaphore.make(1);

  const fork = Effect.fn("SavedWorkspaces.fork")(function* (
    project: string,
    choice: Extract<WorkspaceWorktreeChoice, { kind: "new" }>,
  ) {
    if (!(yield* git.hasCommit(project).pipe(Effect.orElseSucceed(() => false)))) {
      return yield* projectError(
        "This project has no commit yet, so a new worktree cannot be created.",
      );
    }
    const name = (yield* isNameFree(project, choice.name)) ? choice.name : yield* drawName(project);
    const commit = yield* startingCommit(project, choice.startingPoint);
    const target = worktreeTarget(project, name);
    const madeParent = !(yield* fs
      .exists(path.dirname(target))
      .pipe(Effect.orElseSucceed(() => true)));
    yield* git
      .createWorktree({ cwd: project, path: target, refName: commit, newRefName: name })
      .pipe(
        Effect.tapError(() => rollbackFork(project, target, name, madeParent)),
        Effect.mapError((error) =>
          projectError(`The worktree could not be created: ${gitReason(error)}`),
        ),
      );
    return target;
  }, forkLock.withPermits(1));

  // Resolves the choice to the project the shell runs in and the worktree it belongs to.
  const placeShell = Effect.fnUntraced(function* (
    project: string,
    choice: WorkspaceWorktreeChoice | undefined,
  ) {
    switch (choice?.kind) {
      case undefined:
      case "checkout": {
        const isGit = yield* vcs.detect({ cwd: project }).pipe(
          Effect.map((handle) => handle !== null),
          Effect.orElseSucceed(() => false),
        );
        return { cwd: project, worktree: isGit ? project : null };
      }
      case "existing": {
        const worktrees = yield* listWorktrees(project).pipe(
          Effect.mapError((error) =>
            projectError(`The worktrees could not be listed: ${gitReason(error)}`),
          ),
        );
        if (!worktrees.some((worktree) => worktree.path === choice.path)) {
          return yield* projectError(`This is not a worktree of ${project}: ${choice.path}`);
        }
        if (!(yield* isDirectory(choice.path))) {
          return yield* projectError(`The worktree no longer exists: ${choice.path}`);
        }
        return { cwd: choice.path, worktree: choice.path };
      }
      case "new": {
        const created = yield* fork(project, choice);
        return { cwd: created, worktree: created };
      }
    }
  });

  const startShell = Effect.fn("SavedWorkspaces.startShell")(function* (
    input: WorkspaceStartShellInput,
  ) {
    return yield* startLockOf(input.name).withPermits(1)(startShellUnlocked(input));
  });

  const startShellUnlocked = Effect.fn("SavedWorkspaces.startShellUnlocked")(function* (
    input: WorkspaceStartShellInput,
  ) {
    yield* requireProject(input.name, input.project);
    const place = yield* placeShell(input.project, input.worktree);
    // Numbered per workspace in start order; a failed start gives its number back.
    const number = (shellNumbers.get(input.name) ?? 0) + 1;
    shellNumbers.set(input.name, number);
    const shell = yield* shells
      .open(
        {
          cwd: place.cwd,
          agent: true,
          ...(input.cols === undefined ? {} : { cols: input.cols }),
          ...(input.rows === undefined ? {} : { rows: input.rows }),
        },
        {
          title: `Shell ${number}`,
          project: input.project,
          ...(place.worktree === null ? {} : { worktree: place.worktree }),
        },
      )
      .pipe(
        Effect.tapError(() =>
          Effect.sync(() => {
            if (shellNumbers.get(input.name) === number) shellNumbers.set(input.name, number - 1);
          }),
        ),
      );
    // The shell is running either way; failing here would hide it from the caller.
    const worktree = input.worktree ?? { kind: "checkout" as const };
    const lastStart: WorkspaceLastStart = {
      project: input.project,
      worktree:
        worktree.kind === "new" ? { kind: "new", startingPoint: worktree.startingPoint } : worktree,
    };
    yield* rememberStart(input.name, lastStart).pipe(
      Effect.catch((error) =>
        Effect.logWarning("could not remember the workspace's last start", {
          name: input.name,
          reason: error.message,
        }),
      ),
    );
    return shell;
  });

  return {
    list: refresh.pipe(Effect.map((state) => state.workspaces)),
    create,
    remove,
    open,
    addProject,
    removeProject,
    projectGit,
    startShell,
    saveTabs,
    get streamChanges() {
      return Stream.unwrap(
        Effect.gen(function* () {
          const subscription = yield* PubSub.subscribe(changes);
          const snapshot = yield* refreshOrLast;
          return Stream.concat(
            Stream.make(snapshot.workspaces),
            Stream.fromSubscription(subscription).pipe(
              Stream.filter((update) => update.seq > snapshot.seq),
              Stream.map((update) => update.workspaces),
            ),
          );
        }),
      );
    },
  } satisfies SavedWorkspaces["Service"];
});

export const layer = Layer.effect(SavedWorkspaces, make);
