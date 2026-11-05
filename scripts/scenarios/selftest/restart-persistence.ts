import * as Effect from "effect/Effect";

import { connectRpc } from "../rpc.ts";
import type { Scenario } from "../scenario.ts";

const NAME = "persisted-workspace";

export const restartPersistence: Scenario = {
  id: "T1",
  title: "restart keeps data",
  run: async ({ server, openPage }) => {
    const rpc = await connectRpc(server.origin, await openPage());
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
};
