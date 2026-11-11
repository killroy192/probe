import type { PointerPage } from "../../browser.ts";

export const tabs = (page: PointerPage) =>
  page.getByRole("tablist", { name: "Shells" }).getByRole("tab");

/** A shell's tab in the tab strip. */
export const shellTab = (page: PointerPage, shellId: string) =>
  page.getByRole("tablist", { name: "Shells" }).locator(`[data-shell-id="${shellId}"]`);

/** Closes a shell's tab with the "x" its icon turns into on hover. */
export async function closeTab(page: PointerPage, shellId: string) {
  const tab = page
    .getByRole("tablist", { name: "Shells" })
    .locator("div", { has: page.locator(`[data-shell-id="${shellId}"]`) })
    .last();
  await tab.hover();
  await tab.getByRole("button", { name: /^Close / }).click();
  await shellTab(page, shellId).waitFor({ state: "detached" });
}
