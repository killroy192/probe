import { createFileRoute } from "@tanstack/react-router";
import { ChatSettingsPanel } from "../components/settings/SettingsPanels";
import { redirectHiddenChatRoute } from "../terminalFirst";

export const Route = createFileRoute("/_chat/settings/chat")({
  beforeLoad: redirectHiddenChatRoute,
  component: ChatSettingsPanel,
});
