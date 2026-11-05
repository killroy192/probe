import {
  type WorkspaceInput,
  WorkspaceInvalidError,
  WorkspaceNameTakenError,
  WorkspaceNotFoundError,
  WorkspaceStorageError,
  type WorkspaceSummary,
  workspaceNameProblem,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
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

import * as ServerConfig from "../config.ts";

const FILE_SUFFIX = ".json";

// The name lives in the file name; the content is versioned so story 7 can add the layout.
const SavedWorkspaceFile = Schema.Struct({ version: Schema.Literal(1) });
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
    ) => Effect.Effect<WorkspaceSummary, WorkspaceNotFoundError | WorkspaceInvalidError>;
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

const make = Effect.gen(function* () {
  const { workspacesDir } = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
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

  const open = Effect.fn("SavedWorkspaces.open")(function* (input: WorkspaceInput) {
    const raw = yield* fs
      .readFileString(fileOf(input.name))
      .pipe(
        Effect.mapError((error) =>
          error.reason._tag === "NotFound"
            ? new WorkspaceNotFoundError({ name: input.name })
            : new WorkspaceInvalidError({ name: input.name, reason: "its file cannot be read." }),
        ),
      );
    if (Exit.isFailure(decodeSavedWorkspaceFile(raw))) {
      return yield* new WorkspaceInvalidError({
        name: input.name,
        reason: "its file is not a valid workspace file.",
      });
    }
    return { name: input.name };
  });

  return {
    list: refresh.pipe(Effect.map((state) => state.workspaces)),
    create,
    remove,
    open,
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
