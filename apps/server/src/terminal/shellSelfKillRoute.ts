import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import { SELF_KILL_PATH } from "./shellEnv.ts";
import { Shells } from "./Shells.ts";

/**
 * `probe kill` run inside a shell. Outside environment auth, like `/mcp`: the bearer is the
 * shell's own token, which can kill that shell and nothing else.
 */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const router = yield* HttpRouter.HttpRouter;
    const shells = yield* Shells;
    yield* router.add(
      "POST",
      SELF_KILL_PATH,
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const token = /^Bearer (.+)$/.exec(request.headers.authorization ?? "")?.[1];
        if (token === undefined) return HttpServerResponse.empty({ status: 401 });
        return (yield* shells.killByToken(token))
          ? HttpServerResponse.empty({ status: 204 })
          : HttpServerResponse.empty({ status: 401 });
      }),
    );
  }),
);
