import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpRouter } from "effect/http";
import { describe, expect, it } from "vite-plus/test";

import { SELF_KILL_PATH } from "./shellEnv.ts";
import * as ShellSelfKillRoute from "./shellSelfKillRoute.ts";
import { Shells } from "./Shells.ts";

describe("probe kill route", () => {
  it("kills only the shell whose token it is given", async () => {
    const tried: string[] = [];
    const layerApp = ShellSelfKillRoute.layer.pipe(
      Layer.provide(
        Layer.mock(Shells)({
          killByToken: (token: string) =>
            Effect.sync(() => {
              tried.push(token);
              return token === "shell-a-token";
            }),
        }),
      ),
    );
    const { handler, dispose } = HttpRouter.toWebHandler(layerApp, { disableLogger: true });
    const post = (authorization?: string) =>
      handler(
        new Request(`http://127.0.0.1${SELF_KILL_PATH}`, {
          method: "POST",
          ...(authorization === undefined ? {} : { headers: { authorization } }),
        }),
      ).then((response) => response.status);

    try {
      expect(await post("Bearer shell-a-token")).toBe(204);
      expect(await post("Bearer forged")).toBe(401);
      expect(await post("shell-a-token")).toBe(401);
      expect(await post()).toBe(401);
      expect(tried).toEqual(["shell-a-token", "forged"]);
    } finally {
      await dispose();
    }
  });
});
