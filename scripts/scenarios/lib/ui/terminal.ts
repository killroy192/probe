import type { PointerPage } from "../../browser.ts";
import { ACTION_MS, type Deadline, seconds } from "../deadlines.ts";
import { check } from "../waits.ts";

/** A shell's tab panel; a hidden tab's panel stays mounted. */
export const shellPanel = (page: PointerPage, shellId: string) =>
  page.locator(`[role="tabpanel"][data-shell-id="${shellId}"]`);

/** What the page says about a shell's tab right now, for a failure message. */
// A string, since this package has no DOM types; it runs in the page and never waits.
const tabState = (page: PointerPage, shellId: string): Promise<string> =>
  page.evaluate(`(() => {
    const panel = document.querySelector('[role="tabpanel"][data-shell-id="' + CSS.escape(${JSON.stringify(shellId)}) + '"]');
    if (panel === null) return "no tab";
    const surface = panel.querySelector("[data-terminal-attached]");
    const attached = surface === null ? "no surface yet" : surface.getAttribute("data-terminal-attached");
    return "attached: " + attached + ", ready: " + panel.getAttribute("data-shell-ready");
  })()`);

/**
 * Waits until the page shows the shell's tab attached (its terminal takes input) and the shell at
 * its first prompt; hidden tabs count. A shell that ends meanwhile fails at once.
 */
export async function shellReady(
  page: PointerPage,
  shellId: string,
  { deadline = ACTION_MS }: { readonly deadline?: Deadline } = {},
) {
  const panel = shellPanel(page, shellId);
  const wait = { timeout: deadline };
  // An ended shell leaves its tab, so a panel that was there and goes means it ended.
  const hadTab = (await panel.count()) > 0;
  const outcome = await Promise.race([
    page
      .locator(
        `[role="tabpanel"][data-shell-id="${shellId}"][data-shell-ready="ready"]:has([data-terminal-attached="yes"])`,
      )
      .waitFor({ ...wait, state: "attached" })
      .then(() => "ready" as const),
    panel
      .locator('[data-terminal-attached="ended"]')
      .waitFor({ ...wait, state: "attached" })
      .then(() => "ended" as const),
    ...(hadTab ? [panel.waitFor({ ...wait, state: "detached" }).then(() => "ended" as const)] : []),
  ]).catch(() => "timeout" as const);
  if (outcome === "ready") return;
  const seen = await tabState(page, shellId);
  throw new Error(
    outcome === "ended"
      ? `Shell ${shellId} ended while waiting for it to be attached and ready (${seen}).`
      : `Shell ${shellId} never showed attached and ready within ${seconds(deadline)}; its tab last showed ${seen}.`,
  );
}

/** Presses Ctrl+C in the active tab's terminal, the way a user stops the program running there. */
export async function interrupt(page: PointerPage) {
  await page.getByRole("tabpanel").filter({ visible: true }).locator("textarea").press("Control+c");
}

/**
 * Types into the active tab's terminal the way a user does, then submits the line, once the page
 * shows that shell attached and ready, so the line reaches a shell that reads it.
 */
export async function typeLine(
  page: PointerPage,
  text: string,
  options: { readonly deadline?: Deadline } = {},
) {
  const shellId = await page
    .getByRole("tabpanel")
    .filter({ visible: true })
    .getAttribute("data-shell-id");
  check(shellId !== null, "The visible tab names no shell.");
  await shellReady(page, shellId, options);
  const input = shellPanel(page, shellId).locator("textarea");
  await input.click({ force: true });
  await input.pressSequentially(text);
  await input.press("Enter");
}
