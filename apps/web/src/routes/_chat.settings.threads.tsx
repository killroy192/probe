import { createFileRoute } from "@tanstack/react-router";
import { ThreadsSettingsPanel } from "../components/settings/SettingsPanels";
import { redirectHiddenChatRoute } from "../terminalFirst";

export const Route = createFileRoute("/_chat/settings/threads")({
  beforeLoad: redirectHiddenChatRoute,
  component: ThreadsSettingsPanel,
});
