import type { PointerPage } from "../browser.ts";
import type { WsClient } from "./api.ts";
import { ACTION_MS, seconds } from "./deadlines.ts";
import { follow, recorder } from "./waits.ts";

/** Follows the names of the server's saved workspaces over `client`, each list sorted. */
export function followWorkspaces(client: WsClient) {
  const names = recorder<ReadonlyArray<string>>("workspace names");
  follow(client.subscribeWorkspaces({}), ({ workspaces }) =>
    names.push(workspaces.map(({ name }) => name).toSorted()),
  );
  return names;
}

/** Waits until the page's address has the path `path`; a failure names `what` and the path it shows. */
export async function waitForPath(page: PointerPage, path: string, what: string) {
  try {
    await page.waitForURL((url) => url.pathname === path, { timeout: ACTION_MS });
  } catch (cause) {
    throw new Error(
      `Timed out after ${seconds(ACTION_MS)} waiting for ${what}; the page shows ${new URL(page.url()).pathname}.`,
      { cause },
    );
  }
}
