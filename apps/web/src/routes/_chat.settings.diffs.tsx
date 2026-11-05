import { createFileRoute } from "@tanstack/react-router";
import { DiffsSettingsPanel } from "../components/settings/SettingsPanels";
import { redirectHiddenChatRoute } from "../terminalFirst";

export const Route = createFileRoute("/_chat/settings/diffs")({
  beforeLoad: redirectHiddenChatRoute,
  component: DiffsSettingsPanel,
});
