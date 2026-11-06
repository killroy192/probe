import {
  CommandId,
  ProjectId,
  type ShellSummary,
  type WorkspaceAddFolderInput,
  type WorkspaceAddFolderResult,
  type WorkspaceDetail,
  WorkspaceFolderError,
  type WorkspaceFolderGit,
  type WorkspaceFolderGitInput,
  type WorkspaceInput,
  WorkspaceLastStart,
  type WorkspaceWorktreeChoice,
  type WorkspaceWorktreeVisibilityInput,
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

// The name lives in the file name; the content is versioned so story 7 can add the layout.
// Folders arrived after version 1 shipped, so both fields stay optional.
// `lastFolder` is how files written before worktrees remember the last start.
const SavedWorkspaceFile = Schema.Struct({
  version: Schema.Literal(1),
  folders: Schema.optional(
    Schema.Array(
      Schema.Struct({
        path: Schema.String,
        // The worktrees the tree shows, the primary one by the folder's path; absent shows all.
        worktrees: Schema.optional(Schema.Array(Schema.String)),
      }),
    ),
  ),
  lastFolder: Schema.optional(Schema.NullOr(Schema.String)),
  lastStart: Schema.optional(Schema.NullOr(WorkspaceLastStart)),
});
type SavedWorkspaceFile = typeof SavedWorkspaceFile.Type;
type SavedFolder = NonNullable<SavedWorkspaceFile["folders"]>[number];

/** The folder's saved list with `worktree` shown or hidden; `all` stands in for a missing list. */
const withVisibility = (
  saved: SavedFolder,
  worktree: string,
  visible: boolean,
  all: ReadonlyArray<string>,
): SavedFolder => {
  const current = saved.worktrees ?? all;
  return {
    ...saved,
    worktrees: visible
      ? [...new Set([...current, worktree])]
      : current.filter((path) => path !== worktree),
  };
};
const encodeSavedWorkspaceFile = Schema.encodeSync(Schema.fromJsonString(SavedWorkspaceFile));
const decodeSavedWorkspaceFile = Schema.decodeUnknownExit(
  Schema.fromJsonString(SavedWorkspaceFile),
);

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
    readonly addFolder: (
      input: WorkspaceAddFolderInput,
    ) => Effect.Effect<
      WorkspaceAddFolderResult,
      WorkspaceNotFoundError | WorkspaceInvalidError | WorkspaceFolderError | WorkspaceStorageError
    >;
    /** What a git folder offers for a start: its worktrees, branches and a new worktree name. */
    readonly folderGit: (
      input: WorkspaceFolderGitInput,
    ) => Effect.Effect<
      WorkspaceFolderGit,
      WorkspaceNotFoundError | WorkspaceInvalidError | WorkspaceFolderError
    >;
    /** Shows or hides one worktree of a git folder in the tree; nothing on disk changes. */
    readonly setWorktreeVisible: (
      input: WorkspaceWorktreeVisibilityInput,
    ) => Effect.Effect<
      WorkspaceDetail,
      WorkspaceNotFoundError | WorkspaceInvalidError | WorkspaceFolderError | WorkspaceStorageError
    >;
    /**
     * Starts an agent shell in a folder's checkout, a worktree of it, or a new worktree, and
     * remembers that choice. A new worktree that fails to be created leaves nothing behind.
     */
    readonly startShell: (
      input: WorkspaceStartShellInput,
    ) => Effect.Effect<
      ShellSummary,
      | WorkspaceNotFoundError
      | WorkspaceInvalidError
      | WorkspaceFolderError
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

  const remove = Effect.fn("SavedWorkspaces.remove")(function* (input: WorkspaceInput) {
    // Only the workspace's own file goes; folders the workspace refers to are never touched.
    yield* fs
      .remove(fileOf(input.name))
      .pipe(
        Effect.mapError((error) =>
          error.reason._tag === "NotFound"
            ? new WorkspaceNotFoundError({ name: input.name })
            : new WorkspaceStorageError({ operation: "remove", reason: storageReason(error) }),
        ),
      );
    yield* refreshUnlocked.pipe(Effect.ignore);
  }, lock.withPermits(1));

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
    const decoded = decodeSavedWorkspaceFile(raw);
    if (Exit.isFailure(decoded)) {
      return yield* new WorkspaceInvalidError({
        name,
        reason: "its file is not a valid workspace file.",
      });
    }
    return decoded.value;
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
    const folders = yield* Effect.forEach(
      file.folders ?? [],
      Effect.fnUntraced(function* (saved) {
        const folder = saved.path;
        if (!(yield* isDirectory(folder))) {
          return { path: folder, isGitRepository: false, exists: false, worktrees: null };
        }
        const isGitRepository = yield* vcs.detect({ cwd: folder }).pipe(
          Effect.map((handle) => handle !== null),
          Effect.orElseSucceed(() => false),
        );
        const isVisible = (worktree: { readonly path: string; readonly isMain: boolean }) =>
          saved.worktrees === undefined ||
          saved.worktrees.includes(worktree.isMain ? folder : worktree.path);
        const worktrees = isGitRepository
          ? yield* listWorktrees(folder).pipe(
              // The primary worktree first, then the linked ones as git lists them; a subfolder of
              // a repository has no worktree of its own and none are shown for it.
              Effect.map((all) =>
                all.some((worktree) => worktree.isMain)
                  ? [
                      ...all.filter((worktree) => worktree.isMain),
                      ...all.filter((worktree) => !worktree.isMain),
                    ].map((worktree) => ({ ...worktree, visible: isVisible(worktree) }))
                  : null,
              ),
              Effect.orElseSucceed(() => null),
            )
          : null;
        return { path: folder, isGitRepository, exists: true, worktrees };
      }),
      { concurrency: "unbounded" },
    );
    const remembered =
      file.lastStart ??
      (file.lastFolder == null
        ? null
        : { folder: file.lastFolder, worktree: { kind: "checkout" as const } });
    // A remembered folder that left the workspace or the disk is not offered again.
    const lastStart = folders.some((folder) => folder.path === remembered?.folder && folder.exists)
      ? remembered
      : null;
    return { name, folders, lastStart } satisfies WorkspaceDetail;
  });

  const open = Effect.fn("SavedWorkspaces.open")(function* (input: WorkspaceInput) {
    return yield* toDetail(input.name, yield* readFile(input.name));
  });

  const folderError = (reason: string) => new WorkspaceFolderError({ reason });

  const normalizeExisting = (folder: string) =>
    workspacePaths
      .normalizeWorkspaceRoot(folder, { createIfMissing: false })
      .pipe(Effect.mapError((error) => folderError(pathReason(error, folder))));

  // A linked worktree is one checkout of a repository; the workspace holds the repository itself
  // and shows only that worktree of it.
  const repositoryOf = Effect.fnUntraced(function* (folder: string) {
    // Git lists the repository's primary worktree first; a subfolder of a repository is kept.
    const worktrees = yield* listWorktrees(folder).pipe(Effect.orElseSucceed(() => []));
    const own = worktrees.findIndex((worktree) => worktree.isMain);
    const primary = worktrees[0];
    if (own > 0 && primary !== undefined && (yield* isDirectory(primary.path))) {
      return { repository: primary.path, shown: worktrees[own]!.path };
    }
    return { repository: folder, shown: own === 0 ? folder : null };
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
          folderError(
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
    function* (folder: string) {
      const id = yield* randomId;
      yield* projects.bootstrap({
        commandId: CommandId.make(`workspace-folder:${id}`),
        projectId: ProjectId.make(id),
        title: path.basename(folder) || folder,
        workspaceRoot: folder,
        createWorkspaceRootIfMissing: false,
      });
    },
    Effect.mapError((error) =>
      folderError(`The folder could not be registered as a project: ${error.message}`),
    ),
  );

  const addFolder = Effect.fn("SavedWorkspaces.addFolder")(function* (
    input: WorkspaceAddFolderInput,
  ) {
    const file = yield* readFile(input.name);
    let folder: string;
    let resolvedFrom: string | null = null;
    // The worktree the tree shows for this add; a repository starts with only it.
    let shown: string | null;
    if (input.mode === "import") {
      const imported = yield* normalizeExisting(input.path);
      const resolved = yield* repositoryOf(imported);
      folder = resolved.repository;
      shown = resolved.shown;
      if (folder !== imported) resolvedFrom = imported;
      yield* register(folder);
    } else {
      const target = yield* createFolder(input.parentPath, input.folderName);
      // A half-made folder is removed, so a retry with the same name works (ER-3).
      yield* provisioning.initRepository({ cwd: target }).pipe(
        Effect.mapError((error) => folderError(`git init failed: ${error.message}`)),
        Effect.andThen(register(target)),
        Effect.tapError(() => removeCreated(target)),
      );
      folder = target;
      shown = target;
    }
    const folders = file.folders ?? [];
    const existing = folders.find((saved) => saved.path === folder);
    const next =
      existing === undefined
        ? {
            ...file,
            folders: [
              ...folders,
              shown === null ? { path: folder } : { path: folder, worktrees: [shown] },
            ],
          }
        : shown === null || existing.worktrees === undefined || existing.worktrees.includes(shown)
          ? file
          : {
              ...file,
              folders: folders.map((saved) =>
                saved === existing ? withVisibility(saved, shown, true, []) : saved,
              ),
            };
    if (next !== file) yield* writeFile(input.name, next);
    return { workspace: yield* toDetail(input.name, next), folder, resolvedFrom };
  }, lock.withPermits(1));

  // A shell started in a hidden worktree shows that worktree again.
  const rememberStart = Effect.fn("SavedWorkspaces.rememberStart")(function* (
    name: string,
    lastStart: WorkspaceLastStart,
    worktree: string | null,
  ) {
    const { lastFolder: _old, ...file } = yield* readFile(name);
    const folders = file.folders?.map((saved) =>
      saved.path === lastStart.folder && worktree !== null && saved.worktrees !== undefined
        ? withVisibility(saved, worktree, true, [])
        : saved,
    );
    yield* writeFile(name, { ...file, ...(folders === undefined ? {} : { folders }), lastStart });
  }, lock.withPermits(1));

  const setWorktreeVisible = Effect.fn("SavedWorkspaces.setWorktreeVisible")(function* (
    input: WorkspaceWorktreeVisibilityInput,
  ) {
    const file = yield* readFile(input.name);
    const saved = (file.folders ?? []).find((folder) => folder.path === input.folder);
    if (saved === undefined) {
      return yield* folderError(`This folder is not in the workspace: ${input.folder}`);
    }
    const worktrees = yield* listWorktrees(input.folder).pipe(
      Effect.mapError((error) =>
        folderError(`The worktrees could not be listed: ${gitReason(error)}`),
      ),
    );
    // The primary worktree is saved by the folder's path.
    const key = (worktree: { readonly path: string; readonly isMain: boolean }) =>
      worktree.isMain ? input.folder : worktree.path;
    const target = worktrees.find((worktree) => worktree.path === input.worktree);
    if (target === undefined && input.visible) {
      return yield* folderError(`This is not a worktree of ${input.folder}: ${input.worktree}`);
    }
    const next = {
      ...file,
      folders: (file.folders ?? []).map((folder) =>
        folder === saved
          ? withVisibility(
              folder,
              target === undefined ? input.worktree : key(target),
              input.visible,
              worktrees.map(key),
            )
          : folder,
      ),
    };
    yield* writeFile(input.name, next);
    return yield* toDetail(input.name, next);
  }, lock.withPermits(1));

  const requireFolder = Effect.fn("SavedWorkspaces.requireFolder")(function* (
    name: string,
    folder: string,
  ) {
    const file = yield* readFile(name);
    if (!(file.folders ?? []).some((saved) => saved.path === folder)) {
      return yield* folderError(`This folder is not in the workspace: ${folder}`);
    }
    if (!(yield* isDirectory(folder))) {
      return yield* folderError(`The folder no longer exists: ${folder}`);
    }
  });

  const gitReason = (error: { readonly detail: string }) => error.detail;
  const realPath = (folder: string) => fs.realPath(folder).pipe(Effect.orElseSucceed(() => folder));
  const branchExists = (folder: string, branch: string) =>
    git
      .execute({
        operation: "SavedWorkspaces.branchExists",
        cwd: folder,
        args: ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
        allowNonZeroExit: true,
      })
      .pipe(
        Effect.map((result) => result.exitCode === 0),
        Effect.orElseSucceed(() => true),
      );
  const worktreeTarget = (folder: string, name: string) =>
    path.join(worktreesDir, path.basename(path.resolve(folder)), name);

  // A name in use as a branch or a folder is never reused (EC-1).
  const isNameFree = Effect.fnUntraced(function* (folder: string, name: string) {
    if (yield* branchExists(folder, name)) return false;
    return !(yield* fs
      .exists(worktreeTarget(folder, name))
      .pipe(Effect.orElseSucceed(() => false)));
  });

  const drawName = Effect.fnUntraced(function* (folder: string) {
    for (let attempt = 0; attempt < 16; attempt++) {
      const name = `probe-worktree-${(yield* randomId).replaceAll("-", "").slice(0, 6)}`;
      if (yield* isNameFree(folder, name)) return name;
    }
    return yield* folderError("No free worktree name was found. Try again.");
  });

  // The folder's own checkout is the worktree at its path; a folder may itself be a linked one.
  const listWorktrees = Effect.fnUntraced(function* (folder: string) {
    const own = yield* realPath(folder);
    const worktrees = yield* git.listWorktrees(folder);
    return yield* Effect.forEach(worktrees, (worktree) =>
      realPath(worktree.path).pipe(Effect.map((real) => ({ ...worktree, isMain: real === own }))),
    );
  });

  const folderGit = Effect.fn("SavedWorkspaces.folderGit")(function* (
    input: WorkspaceFolderGitInput,
  ) {
    yield* requireFolder(input.name, input.folder);
    const [worktrees, branches, hasCommit] = yield* Effect.all(
      [
        Effect.result(listWorktrees(input.folder)),
        Effect.result(git.listLocalBranchNames(input.folder)),
        git.hasCommit(input.folder).pipe(Effect.orElseSucceed(() => false)),
      ],
      { concurrency: "unbounded" },
    );
    const currentBranch =
      worktrees._tag === "Success"
        ? (worktrees.success.find((worktree) => worktree.isMain)?.branch ?? null)
        : yield* git
            .execute({
              operation: "SavedWorkspaces.currentBranch",
              cwd: input.folder,
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
      proposedWorktreeName: yield* drawName(input.folder),
      worktreesError: worktrees._tag === "Failure" ? gitReason(worktrees.failure) : null,
      branchesError: branches._tag === "Failure" ? gitReason(branches.failure) : null,
    } satisfies WorkspaceFolderGit;
  });

  // Removes only what this attempt made: its registered worktree, its folder and its branch.
  const rollbackFork = Effect.fnUntraced(function* (
    folder: string,
    target: string,
    branch: string,
    madeParent: boolean,
  ) {
    const registered = yield* listWorktrees(folder).pipe(
      Effect.map((worktrees) => worktrees.some((worktree) => worktree.path === target)),
      Effect.orElseSucceed(() => false),
    );
    if (registered) {
      yield* git
        .removeWorktree({ cwd: folder, path: target, force: true })
        .pipe(Effect.ignore({ log: true }));
    }
    yield* fs.remove(target, { recursive: true }).pipe(Effect.ignore);
    if (yield* branchExists(folder, branch)) {
      yield* git
        .deleteLocalBranch({ cwd: folder, refName: branch, force: true })
        .pipe(Effect.ignore({ log: true }));
    }
    if (madeParent) {
      const parent = path.dirname(target);
      const left = yield* fs.readDirectory(parent).pipe(Effect.orElseSucceed(() => ["?"]));
      if (left.length === 0) yield* fs.remove(parent).pipe(Effect.ignore);
    }
  });

  const startingCommit = Effect.fnUntraced(function* (
    folder: string,
    startingPoint: Extract<WorkspaceWorktreeChoice, { kind: "new" }>["startingPoint"],
  ) {
    if (startingPoint.kind === "branch") {
      return yield* git
        .resolveCommit({ cwd: folder, revision: `refs/heads/${startingPoint.name}` })
        .pipe(
          Effect.map((resolved) => resolved.commitSha),
          Effect.mapError(() =>
            folderError(`The starting branch "${startingPoint.name}" no longer exists.`),
          ),
        );
    }
    const worktrees = yield* listWorktrees(folder).pipe(
      Effect.mapError((error) =>
        folderError(`The worktrees could not be listed: ${gitReason(error)}`),
      ),
    );
    const source = worktrees.find((worktree) => worktree.path === startingPoint.path);
    if (source === undefined) {
      return yield* folderError(`The starting worktree no longer exists: ${startingPoint.path}`);
    }
    return source.head;
  });

  // Serializes forks, so two starts never draw or check the same name at once (EC-9).
  const forkLock = yield* Semaphore.make(1);

  const fork = Effect.fn("SavedWorkspaces.fork")(function* (
    folder: string,
    choice: Extract<WorkspaceWorktreeChoice, { kind: "new" }>,
  ) {
    if (!(yield* git.hasCommit(folder).pipe(Effect.orElseSucceed(() => false)))) {
      return yield* folderError(
        "This folder has no commit yet, so a new worktree cannot be created.",
      );
    }
    const name = (yield* isNameFree(folder, choice.name)) ? choice.name : yield* drawName(folder);
    const commit = yield* startingCommit(folder, choice.startingPoint);
    const target = worktreeTarget(folder, name);
    const madeParent = !(yield* fs
      .exists(path.dirname(target))
      .pipe(Effect.orElseSucceed(() => true)));
    yield* git
      .createWorktree({ cwd: folder, path: target, refName: commit, newRefName: name })
      .pipe(
        Effect.tapError(() => rollbackFork(folder, target, name, madeParent)),
        Effect.mapError((error) =>
          folderError(`The worktree could not be created: ${gitReason(error)}`),
        ),
      );
    return target;
  }, forkLock.withPermits(1));

  // Resolves the choice to the folder the shell runs in and the worktree it belongs to.
  const placeShell = Effect.fnUntraced(function* (
    folder: string,
    choice: WorkspaceWorktreeChoice | undefined,
  ) {
    switch (choice?.kind) {
      case undefined:
      case "checkout": {
        const isGit = yield* vcs.detect({ cwd: folder }).pipe(
          Effect.map((handle) => handle !== null),
          Effect.orElseSucceed(() => false),
        );
        return { cwd: folder, worktree: isGit ? folder : null };
      }
      case "existing": {
        const worktrees = yield* listWorktrees(folder).pipe(
          Effect.mapError((error) =>
            folderError(`The worktrees could not be listed: ${gitReason(error)}`),
          ),
        );
        if (!worktrees.some((worktree) => worktree.path === choice.path)) {
          return yield* folderError(`This is not a worktree of ${folder}: ${choice.path}`);
        }
        if (!(yield* isDirectory(choice.path))) {
          return yield* folderError(`The worktree no longer exists: ${choice.path}`);
        }
        return { cwd: choice.path, worktree: choice.path };
      }
      case "new": {
        const created = yield* fork(folder, choice);
        return { cwd: created, worktree: created };
      }
    }
  });

  const startShell = Effect.fn("SavedWorkspaces.startShell")(function* (
    input: WorkspaceStartShellInput,
  ) {
    yield* requireFolder(input.name, input.folder);
    const place = yield* placeShell(input.folder, input.worktree);
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
          folder: input.folder,
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
      folder: input.folder,
      worktree:
        worktree.kind === "new" ? { kind: "new", startingPoint: worktree.startingPoint } : worktree,
    };
    yield* rememberStart(input.name, lastStart, place.worktree).pipe(
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
    addFolder,
    folderGit,
    setWorktreeVisible,
    startShell,
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
