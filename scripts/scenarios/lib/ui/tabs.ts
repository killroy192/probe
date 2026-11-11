import type { PointerPage } from "../../browser.ts";
import { waitFor } from "../waits.ts";

const tabStrip = (page: PointerPage) => page.getByRole("tablist", { name: "Shells" });

export const tabs = (page: PointerPage) => tabStrip(page).getByRole("tab");

/** A shell's tab in the tab strip. */
export const shellTab = (page: PointerPage, shellId: string) =>
  tabStrip(page).locator(`[data-shell-id="${shellId}"]`);

/** A shell's tab while it is the selected one. */
export const selectedShellTab = (page: PointerPage, shellId: string) =>
  shellTab(page, shellId).and(page.locator('[aria-selected="true"]'));

/** The shell ids of the open tabs, in strip order. */
export const tabIds = (page: PointerPage) =>
  tabs(page).evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-shell-id")));

/** The shell id of the selected tab, or null with none selected. */
export async function selectedTab(page: PointerPage) {
  const selected = tabStrip(page).locator('[role="tab"][aria-selected="true"]');
  return (await selected.count()) === 0 ? null : selected.getAttribute("data-shell-id");
}

/** Closes a shell's tab with the "x" its icon turns into on hover. */
export async function closeTab(page: PointerPage, shellId: string) {
  const tab = tabStrip(page)
    .locator("div", { has: page.locator(`[data-shell-id="${shellId}"]`) })
    .last();
  await tab.hover();
  await tab.getByRole("button", { name: /^Close / }).click();
  await waitFor(shellTab(page, shellId), `the tab of shell ${shellId} to close`, {
    state: "detached",
  });
}
