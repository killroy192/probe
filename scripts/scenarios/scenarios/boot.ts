// @effect-diagnostics nodeBuiltinImport:off - Reads the throwaway home the server reports it is using.

import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import type { Scenario } from "../scenario.ts";

export const boot: Scenario = {
  id: "S1",
  title: "boot",
  run: async ({ server, openPage }) => {
    const runtime = JSON.parse(
      await NodeFSP.readFile(NodePath.join(server.home, "userdata", "server-runtime.json"), "utf8"),
    ) as { readonly pid: number };
    if (runtime.pid !== server.pid()) {
      throw new Error(`The server using ${server.home} is not the one this run started.`);
    }
    if ((await NodeFSP.realpath(server.home)).startsWith(NodePath.join(NodeOS.homedir(), ".t3"))) {
      throw new Error(`The throwaway home ${server.home} is inside ~/.t3.`);
    }

    const page = await openPage();
    // The first screen has an "Add project" action; story 3 replaces the start screen.
    await page.getByText("Add project").first().waitFor();
    if (await page.getByText("Something went wrong.").count()) {
      throw new Error("The first page shows an error state.");
    }
  },
};
