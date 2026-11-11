import type { PointerPage } from "../browser.ts";
import type { ServerEnv, ServerHandle } from "../server.ts";
import { connectRpc, type RpcConnection } from "./api.ts";
import { ACTION_MS, type Deadline, seconds } from "./deadlines.ts";
import { waitFor } from "./waits.ts";

/**
 * Records every layout save state the page shows, from each page load on, so a scenario can
 * check what showed between two moments; `layoutStates` reads them. Install before loading.
 */
export async function recordLayoutStates(page: PointerPage) {
  await page.addInitScript(`(() => {
    const states = (window.__layoutStates = []);
    new MutationObserver(() => {
      const screen = document.querySelector('[data-testid="workspace-screen"]');
      const value = screen === null ? null : screen.getAttribute("data-layout-save");
      if (states[states.length - 1] !== value) states.push(value);
    }).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-layout-save"],
    });
  })()`);
}

/** The layout save states this page load showed so far, in order; null where none showed. */
export const layoutStates = (page: PointerPage) =>
  page.evaluate("window.__layoutStates") as Promise<ReadonlyArray<string | null>>;

/** The workspace screen while it shows the shown workspace's layout save as `state`. */
export const layoutState = (page: PointerPage, state: "pending" | "saved" | "failed") =>
  page.locator(`[data-testid="workspace-screen"][data-layout-save="${state}"]`);

/**
 * Waits until the page shows the shown workspace's layout saved, so a reload or a server stop
 * after a tab change finds the tabs it set. Returns at once on a page that shows no workspace.
 */
export async function layoutSaved(
  page: PointerPage,
  workspace: string,
  { deadline = ACTION_MS }: { readonly deadline?: Deadline } = {},
) {
  const screen = page.getByTestId("workspace-screen");
  if ((await screen.getAttribute("data-layout-save")) === null) return;
  const state = (value: "saved" | "failed") => layoutState(page, value);
  const wait = { timeout: deadline };
  const outcome = await Promise.race([
    state("saved")
      .waitFor(wait)
      .then(() => "saved" as const),
    state("failed")
      .waitFor(wait)
      .then(() => "failed" as const),
  ]).catch(() => "timeout" as const);
  if (outcome === "saved") return;
  const seen = await screen.getAttribute("data-layout-save");
  throw new Error(
    outcome === "failed"
      ? `Saving the layout of ${workspace} failed (the page shows ${seen}).`
      : `The layout of ${workspace} was never saved within ${seconds(deadline)}; the page last showed ${seen}.`,
  );
}

/**
 * Reloads the page and waits for `name` to show. A page that showed a workspace brings it back
 * by itself (PRB.T-007); a page that never did opens it from the start screen.
 */
export async function reloadShowing(page: PointerPage, name: string) {
  await layoutSaved(page, name);
  const remembered = await page.evaluate(() =>
    Object.keys(localStorage).some((key) => key.startsWith("probe:shown-workspace:")),
  );
  await page.reload();
  if (!remembered) {
    await page
      .getByTestId("workspace-screen")
      .getByRole("button", { name: "Open workspace" })
      .click();
    await page.getByRole("menuitem", { name, exact: true }).click();
  }
  await waitFor(
    page.getByRole("tree").getByRole("treeitem", { level: 1, name }),
    `the tree to show workspace ${name} after the reload`,
  );
}

/** Restarts the server (a real restart), reloads the page onto "sparta" and connects again. */
export async function restartAndReload(
  page: PointerPage,
  server: ServerHandle,
  rpc: RpcConnection,
  env?: ServerEnv,
): Promise<RpcConnection> {
  // A stop with a tab change still in flight would bring the old tab strip back.
  await layoutSaved(page, "sparta");
  await rpc.close();
  await server.restart(env === undefined ? undefined : { env });
  await reloadShowing(page, "sparta");
  return connectRpc(server.origin, page);
}
