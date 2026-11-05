import { redirect } from "@tanstack/react-router";

import type { KeybindingCommand } from "@t3tools/contracts";

import type { SettingsPath, SettingsSearchItemId } from "./components/settings/settingsSearch";

// Chat stays in the code until a later epic deletes it; until then it is hidden behind these.

/** Whether chat-only app controls (pull requests, usage) are shown. */
export const CHAT_VISIBLE: boolean = false;

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
  // SnapShots attach screenshots to a chat message.
  "/settings/snap-shot",
]);

/** `beforeLoad` of every chat route: an old chat address lands on the workspace screen. */
export function redirectHiddenChatRoute(): never {
  throw redirect({ to: "/", replace: true });
}

/** Rows on visible settings pages that only configure chat. */
export const HIDDEN_SETTINGS_ROWS: ReadonlySet<string> = new Set<SettingsSearchItemId>([
  "working-shelf",
  "unpin-confirmation",
  "archive-confirmation",
  "delete-confirmation",
  "thread-details-items",
  "effort-display",
  "math-rendering",
  "prompt-font",
  "composer-context",
  "word-wrap",
  "guest-links",
  "simlock-hosts",
  "legacy-plan-mode",
  "legacy-context-window-indicator",
  "provider-update-checks",
  "continue-threads-after-server-update",
  "remove-agent-credits-on-merge",
  "source-control-writing-style",
  "source-control-writer-model",
  "follow-change-request-templates",
  "review-guides",
  "review-guide-model",
  "review-guide-instructions",
  "hold-webhooks-while-offline",
  "publish-agent-activity",
  "pull-request-routing",
]);

/** Chat settings kept for shells, under the names they will have there. */
export const RENAMED_SETTINGS_ROWS: Partial<Record<SettingsSearchItemId, string>> = {
  "chat-width": "Shell width",
  "thread-notifications": "Shell notifications",
};

const HIDDEN_COMMAND_PREFIXES = [
  "chat.",
  "composer.",
  "usage.",
  "rightPanel.",
  "threadPanel.",
  "diff.",
  "preview.",
  "pullRequest.",
];
const HIDDEN_COMMANDS = new Set([
  "commandPalette.toggle",
  "filePicker.toggle",
  "projectSearch.toggle",
]);

/** Keybinding commands that act on chat, hidden from the keybindings page. */
export function isHiddenChatCommand(command: KeybindingCommand): boolean {
  return (
    HIDDEN_COMMANDS.has(command) ||
    HIDDEN_COMMAND_PREFIXES.some((prefix) => command.startsWith(prefix))
  );
}
