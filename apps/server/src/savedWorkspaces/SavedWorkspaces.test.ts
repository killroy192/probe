import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as SavedWorkspaces from "./SavedWorkspaces.ts";

type Env =
  | SavedWorkspaces.SavedWorkspaces
  | ServerConfig.ServerConfig
  | FileSystem.FileSystem
  | Path.Path
  | Scope.Scope;

const withWorkspaces = <A, E>(
  seeds: Readonly<Record<string, string>>,
  body: (dir: string) => Effect.Effect<A, E, Env>,
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
    return yield* body(dir).pipe(
      Effect.provide(
        SavedWorkspaces.layer.pipe(
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
        assert.deepStrictEqual(yield* workspaces.open({ name: "sparta" }), { name: "sparta" });
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
});
