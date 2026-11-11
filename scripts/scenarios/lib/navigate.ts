import type { PointerPage } from "../browser.ts";
import type { ServerEnv } from "../server.ts";
import { ACTION_MS, type Deadline, seconds } from "./deadlines.ts";
import { waitFor } from "./waits.ts";
import {
  setupOn,
  type Setup,
  type SetupContext,
  type ShellResult,
  type WorkspaceResult,
} from "./setup.ts";
import { openFromTree, workspaceRoot, workspaceShown } from "./ui/tree.ts";
import { openWorkspace, startScreenButton } from "./ui/workspacesMenu.ts";

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
  await reloadOnto(page, name);
}

/** `reloadShowing` for a caller that waited for the layout saved itself. */
async function reloadOnto(page: PointerPage, name: string) {
  const remembered = await page.evaluate(() =>
    Object.keys(localStorage).some((key) => key.startsWith("probe:shown-workspace:")),
  );
  await page.reload();
  if (!remembered) {
    // "Create workspace" joins the start screen once the page learns it may change workspaces,
    // moving "Open workspace" and shutting a menu opened before; harness pages may.
    await waitFor(
      startScreenButton(page, "Create workspace"),
      "the start screen to offer Create workspace after the reload",
    );
    await startScreenButton(page, "Open workspace").click();
    await page.getByRole("menuitem", { name, exact: true }).click();
  }
  await workspaceShown(page, name, " after the reload");
}

/**
 * Restarts the server with `env`, reloads the page onto `ws` and sets up as it again, once the
 * first shell list after the restart arrived; `previous` is closed before the stop. `lostHost`
 * stops the host while the server is down: under a running server its shells end signalled.
 */
export async function restartAndReload(
  ctx: SetupContext,
  page: PointerPage,
  ws: string | WorkspaceResult,
  previous: { readonly close: () => Promise<void> },
  { env, lostHost = false }: { readonly env?: ServerEnv; readonly lostHost?: boolean } = {},
): Promise<Setup> {
  const name = typeof ws === "string" ? ws : ws.name;
  // A stop with a tab change still in flight would bring the old tab strip back.
  await layoutSaved(page, name);
  await previous.close();
  if (lostHost) {
    await ctx.server.stop();
    await ctx.server.stopShellHost();
  }
  await ctx.server.restart(env === undefined ? undefined : { env });
  // The layout was saved before the stop, and nothing on the page changed it since.
  await reloadOnto(page, name);
  const setup = await setupOn(ctx, { as: page });
  await setup.shells.lists.until("the shell list after the restart", () => true, 0);
  return setup;
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

/** A page showing a workspace. */
export interface ShownPage {
  readonly kind: "page";
  readonly page: PointerPage;
  readonly workspace: WorkspaceResult;
}

/**
 * Brings the page to `ws` with the "Workspaces" menu, from the start screen or another workspace,
 * and waits for the tree to show it; a failure names the workspace and what the menu offered.
 */
/** Waits until the page has settled on a workspace or the start screen, so the app has booted. */
export async function pageSettled(page: PointerPage, before: string) {
  const startScreen = startScreenButton(page, "Open workspace");
  await waitFor(
    startScreen.or(page.getByRole("tree").getByRole("treeitem", { level: 1 })).first(),
    `the page to settle on a workspace or the start screen before ${before}`,
  );
}

export async function showWorkspace(page: PointerPage, ws: WorkspaceResult): Promise<ShownPage> {
  const shown: ShownPage = { kind: "page", page, workspace: ws };
  const header = workspaceRoot(page, ws.name);
  // A remembered workspace may still be coming back: wait until the page settles on one or none.
  await pageSettled(page, `showing ${ws.name}`);
  if ((await header.count()) > 0) return shown;
  try {
    await openWorkspace(page, ws.name);
  } catch (cause) {
    const offered = await page.getByRole("menu").last().getByRole("menuitem").allTextContents();
    const list = offered.map((name) => JSON.stringify(name.trim())).join(", ");
    throw new Error(
      `Workspace ${ws.name} was not shown: the "Open workspace" list offers ${list || "nothing"}.`,
      { cause },
    );
  }
  try {
    await waitFor(header, `the tree to show workspace ${ws.name}`);
  } catch (cause) {
    throw new Error(`Workspace ${ws.name} was not shown: the tree never showed it.`, { cause });
  }
  return shown;
}

/** Opens a shell's tab from its tree row, since a shell started over the API gets no tab. */
export const openTab = (page: PointerPage, shell: ShellResult) => openFromTree(page, shell.shellId);
