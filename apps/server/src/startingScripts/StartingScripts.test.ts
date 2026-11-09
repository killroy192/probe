import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { expect } from "vite-plus/test";

import * as ServerConfig from "../config.ts";
import * as StartingScripts from "./StartingScripts.ts";

const MOCK = "node mock-agent.ts";

/** Builds the service on `baseDir` as a fresh server start would, and reads its list. */
const listOn = (baseDir: string, seedMockAgent?: string) =>
  Effect.gen(function* () {
    return yield* (yield* StartingScripts.StartingScripts).list;
  }).pipe(
    Effect.provide(
      StartingScripts.layer.pipe(
        Layer.provide(
          Layer.effect(
            ServerConfig.ServerConfig,
            Effect.gen(function* () {
              const config = yield* ServerConfig.ServerConfig;
              return { ...config, seedMockAgent };
            }),
          ).pipe(Layer.provide(ServerConfig.layerTest(process.cwd(), baseDir))),
        ),
      ),
    ),
  );

const fileIn = (baseDir: string) =>
  Path.Path.pipe(Effect.map((path) => path.join(baseDir, "userdata", "starting-scripts.json")));

it.layer(NodeServices.layer)("starting scripts", (it) => {
  it.effect("gives a state folder with no list the mock agent only where the default is on", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const seeded = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-starting-scripts-" });
      const plain = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-starting-scripts-" });

      const first = yield* listOn(seeded, MOCK);
      expect(first.scripts.map(({ name, command }) => ({ name, command }))).toEqual([
        { name: "mock agent", command: MOCK },
      ]);
      assert.isNull(first.problem);
      // The identity is kept across restarts.
      assert.deepStrictEqual((yield* listOn(seeded, MOCK)).scripts, first.scripts);

      assert.deepStrictEqual(yield* listOn(plain), { scripts: [], problem: null });
      assert.isFalse(yield* fs.exists(yield* fileIn(plain)));
    }).pipe(Effect.scoped),
  );

  it.effect("keeps a list the user emptied empty, and is not seeded again", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-starting-scripts-" });
      const file = yield* fileIn(baseDir);
      yield* fs.makeDirectory((yield* Path.Path).dirname(file), { recursive: true });
      yield* fs.writeFileString(file, '{"version":1,"scripts":[]}');

      assert.deepStrictEqual(yield* listOn(baseDir, MOCK), { scripts: [], problem: null });
      assert.strictEqual(yield* fs.readFileString(file), '{"version":1,"scripts":[]}');
    }).pipe(Effect.scoped),
  );

  it.effect("offers every saved entry as written, told apart by identity", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-starting-scripts-" });
      const file = yield* fileIn(baseDir);
      yield* fs.makeDirectory((yield* Path.Path).dirname(file), { recursive: true });
      const scripts = [
        { id: "a", name: "", command: "claude" },
        { id: "b", name: "agent", command: "claude" },
        { id: "c", name: "agent", command: "claude" },
      ];
      yield* fs.writeFileString(file, JSON.stringify({ version: 1, scripts }));

      assert.deepStrictEqual(yield* listOn(baseDir, MOCK), { scripts, problem: null });
      const found = yield* Effect.gen(function* () {
        return yield* (yield* StartingScripts.StartingScripts).find("c");
      }).pipe(
        Effect.provide(
          StartingScripts.layer.pipe(
            Layer.provide(ServerConfig.layerTest(process.cwd(), baseDir)),
          ),
        ),
      );
      assert.deepStrictEqual(found, Option.some(scripts[2]!));
    }).pipe(Effect.scoped),
  );

  it.effect("reads a damaged list as empty, says why, logs it and leaves the file alone", () => {
    const warnings: Array<string> = [];
    const logger = Logger.make(({ logLevel, message }) => {
      const [text] = Array.isArray(message) ? message : [message];
      if (logLevel === "Warn") warnings.push(String(text));
    });
    return Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-starting-scripts-" });
      const file = yield* fileIn(baseDir);
      yield* fs.makeDirectory((yield* Path.Path).dirname(file), { recursive: true });
      yield* fs.writeFileString(file, "{ not json");

      const read = yield* listOn(baseDir, MOCK);

      assert.deepStrictEqual(read.scripts, []);
      expect(read.problem).toContain("damaged");
      expect(warnings).toContain("the starting scripts could not be read");
      assert.strictEqual(yield* fs.readFileString(file), "{ not json");
    }).pipe(Effect.scoped, Effect.provide(Logger.layer([logger], { mergeWithExisting: false })));
  });
});
