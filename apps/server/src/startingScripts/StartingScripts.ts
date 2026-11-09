import { StartingScript, type StartingScriptList } from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";

/** The user's starting scripts, kept in the state folder of the server that serves the UI. */
export class StartingScripts extends Context.Service<
  StartingScripts,
  {
    /** The saved list; a list that cannot be read is empty and says why. */
    readonly list: Effect.Effect<StartingScriptList>;
    /** The script with this id in the list as saved now. */
    readonly find: (id: string) => Effect.Effect<Option.Option<StartingScript>>;
  }
>()("t3/startingScripts/StartingScripts") {}

const FILE_NAME = "starting-scripts.json";

const StartingScriptsFile = Schema.Struct({
  version: Schema.Literal(1),
  scripts: Schema.Array(StartingScript),
});
const decodeFile = Schema.decodeUnknownExit(Schema.fromJsonString(StartingScriptsFile));
const encodeFile = Schema.encodeSync(Schema.fromJsonString(StartingScriptsFile));

const make = Effect.gen(function* () {
  const { stateDir, seedMockAgent } = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const filePath = path.join(stateDir, FILE_NAME);

  // A saved list, even an empty one, is the user's: only a state folder with none gets the default.
  if (seedMockAgent !== undefined && !(yield* fs.exists(filePath).pipe(Effect.orElseSucceed(() => true)))) {
    const id = yield* crypto.randomUUIDv4().pipe(Effect.orDie);
    yield* writeFileStringAtomically({
      filePath,
      contents: encodeFile({ version: 1, scripts: [{ id, name: "mock agent", command: seedMockAgent }] }),
    }).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.catch((error) =>
        Effect.logWarning("could not save the default starting scripts", { reason: error.message }),
      ),
    );
  }

  // Read on every call: the list is small, and the file may change outside Probe.
  const list = Effect.gen(function* () {
    const read = yield* fs.readFileString(filePath).pipe(Effect.exit);
    if (Exit.isFailure(read)) {
      const missing = yield* fs.exists(filePath).pipe(Effect.orElseSucceed(() => false));
      if (!missing) return { scripts: [], problem: null } satisfies StartingScriptList;
      return yield* damaged("The starting scripts file cannot be read.");
    }
    const decoded = decodeFile(read.value);
    if (Exit.isFailure(decoded)) return yield* damaged("The starting scripts file is damaged.");
    return { scripts: decoded.value.scripts, problem: null } satisfies StartingScriptList;
  });

  // The file is left as it is, so nothing the user wrote is lost.
  const damaged = Effect.fnUntraced(function* (problem: string) {
    yield* Effect.logWarning("the starting scripts could not be read", { file: filePath, problem });
    return { scripts: [], problem } satisfies StartingScriptList;
  });

  return StartingScripts.of({
    list: list.pipe(Effect.withSpan("StartingScripts.list")),
    find: Effect.fn("StartingScripts.find")(function* (id: string) {
      const { scripts } = yield* list;
      return Option.fromNullishOr(scripts.find((script) => script.id === id));
    }),
  });
});

export const layer = Layer.effect(StartingScripts, make);
