import { redirect } from "@tanstack/react-router";

import type { SettingsPath } from "./components/settings/settingsSearch";

// Chat stays in the code until a later epic deletes it; until then it is hidden behind these.

/** Settings pages that belong to chat; hidden from settings navigation and search. */
export const HIDDEN_SETTINGS_PATHS: ReadonlySet<SettingsPath> = new Set<SettingsPath>([
  "/settings/chat",
  "/settings/threads",
  "/settings/archived",
  "/settings/providers",
  "/settings/scheduled-tasks",
  "/settings/projects",
  "/settings/browser",
  "/settings/devices",
  "/settings/diffs",
]);

/** `beforeLoad` of every chat route: an old chat address lands on the workspace screen. */
export function redirectHiddenChatRoute(): never {
  throw redirect({ to: "/", replace: true });
}
