import { createFileRoute } from "@tanstack/react-router";
import { DevicesSettingsPanel } from "../components/settings/IntegrationsSettings";
import { redirectHiddenChatRoute } from "../terminalFirst";

export const Route = createFileRoute("/_chat/settings/devices")({
  beforeLoad: redirectHiddenChatRoute,
  component: DevicesSettingsPanel,
});
