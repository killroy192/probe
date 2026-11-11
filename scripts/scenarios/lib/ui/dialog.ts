import type { PointerPage } from "../../browser.ts";

/** The page's alerts, or the ones that say `text`. */
export const alert = (page: PointerPage, text?: string) =>
  text === undefined ? page.getByRole("alert") : page.getByRole("alert").filter({ hasText: text });

// Toasts are dialogs too; the app's modals are the dialog popups.
export const dialog = (page: PointerPage) =>
  page.getByRole("dialog").and(page.locator('[data-slot="dialog-popup"]'));
