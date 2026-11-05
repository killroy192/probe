import {
  CommandId,
  ProjectId,
  type ShellSummary,
  type WorkspaceAddFolderInput,
  type WorkspaceAddFolderResult,
  type WorkspaceDetail,
  WorkspaceFolderError,
  type WorkspaceInput,
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
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProvisioningService from "../vcs/VcsProvisioningService.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";

const FILE_SUFFIX = ".json";

// The name lives in the file name; the content is versioned so story 7 can add the layout.
// Folders arrived after version 1 shipped, so both fields stay optional.
const SavedWorkspaceFile = Schema.Struct({
  version: Schema.Literal(1),
  folders: Schema.optional(Schema.Array(Schema.Struct({ path: Schema.String }))),
  lastFolder: Schema.optional(Schema.NullOr(Schema.String)),
});
type SavedWorkspaceFile = typeof SavedWorkspaceFile.Type;
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
    /** Starts an agent shell in one of the workspace's folders and remembers that folder. */
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
  const { workspacesDir } = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const projects = yield* ProjectService.ProjectService;
  const vcs = yield* VcsDriverRegistry.VcsDriverRegistry;
  const provisioning = yield* VcsProvisioningService.VcsProvisioningService;
  const workspacePaths = yield* WorkspacePaths.WorkspacePaths;
  const shells = yield* Shells.Shells;
  const randomId = (yield* Crypto.Crypto).randomUUIDv4().pipe(Effect.orDie);
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
    const folderPaths = (file.folders ?? []).map((folder) => folder.path);
    const folders = yield* Effect.forEach(
      folderPaths,
      Effect.fnUntraced(function* (folder) {
        if (!(yield* isDirectory(folder))) {
          return { path: folder, isGitRepository: false, exists: false };
        }
        const isGitRepository = yield* vcs.detect({ cwd: folder }).pipe(
          Effect.map((handle) => handle !== null),
          Effect.orElseSucceed(() => false),
        );
        return { path: folder, isGitRepository, exists: true };
      }),
      { concurrency: "unbounded" },
    );
    // A remembered folder that left the workspace or the disk is not offered again.
    const last = file.lastFolder ?? null;
    const lastFolder = folders.some((folder) => folder.path === last && folder.exists)
      ? last
      : null;
    return { name, folders, lastFolder } satisfies WorkspaceDetail;
  });

  const open = Effect.fn("SavedWorkspaces.open")(function* (input: WorkspaceInput) {
    return yield* toDetail(input.name, yield* readFile(input.name));
  });

  const folderError = (reason: string) => new WorkspaceFolderError({ reason });

  const normalizeExisting = (folder: string) =>
    workspacePaths
      .normalizeWorkspaceRoot(folder, { createIfMissing: false })
      .pipe(Effect.mapError((error) => folderError(pathReason(error, folder))));

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
    if (input.mode === "import") {
      folder = yield* normalizeExisting(input.path);
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
    }
    const folders = file.folders ?? [];
    const next = folders.some((existing) => existing.path === folder)
      ? file
      : { ...file, folders: [...folders, { path: folder }] };
    if (next !== file) yield* writeFile(input.name, next);
    return { workspace: yield* toDetail(input.name, next), folder };
  }, lock.withPermits(1));

  const rememberFolder = Effect.fn("SavedWorkspaces.rememberFolder")(function* (
    name: string,
    folder: string,
  ) {
    const file = yield* readFile(name);
    if (file.lastFolder === folder) return;
    yield* writeFile(name, { ...file, lastFolder: folder });
  }, lock.withPermits(1));

  const startShell = Effect.fn("SavedWorkspaces.startShell")(function* (
    input: WorkspaceStartShellInput,
  ) {
    const file = yield* readFile(input.name);
    if (!(file.folders ?? []).some((folder) => folder.path === input.folder)) {
      return yield* folderError(`This folder is not in the workspace: ${input.folder}`);
    }
    if (!(yield* isDirectory(input.folder))) {
      return yield* folderError(`The folder no longer exists: ${input.folder}`);
    }
    const shell = yield* shells.open({
      cwd: input.folder,
      agent: true,
      ...(input.cols === undefined ? {} : { cols: input.cols }),
      ...(input.rows === undefined ? {} : { rows: input.rows }),
    });
    // The shell is running either way; failing here would hide it from the caller.
    yield* rememberFolder(input.name, input.folder).pipe(
      Effect.catch((error) =>
        Effect.logWarning("could not remember the workspace's last folder", {
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
