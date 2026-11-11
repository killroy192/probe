import * as Effect from "effect/Effect";

import { connectApi } from "../lib/api.ts";
import { defineCheck } from "../scenario.ts";

const NAME = "persisted-workspace";

export const restartPersistence = defineCheck(import.meta.url, {
  id: "T1",
  title: "restart keeps data",
  needs: { restart: true },
  run: async ({ server, openPage }) => {
    const rpc = await connectApi(server, await openPage());
    try {
      await Effect.runPromise(rpc.client["workspace.create"]({ name: NAME }));
    } finally {
      await rpc.close();
    }

    await server.restart();

    const page = await openPage();
    await page.getByRole("button", { name: "Open workspace" }).click();
    await page.getByRole("menuitem", { name: NAME }).waitFor();
  },
});
