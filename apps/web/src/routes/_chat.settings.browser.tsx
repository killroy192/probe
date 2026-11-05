import { createFileRoute } from "@tanstack/react-router";
import { BrowserSettingsPanel } from "../components/settings/IntegrationsSettings";
import { redirectHiddenChatRoute } from "../terminalFirst";

export const Route = createFileRoute("/_chat/settings/browser")({
  beforeLoad: redirectHiddenChatRoute,
  component: BrowserSettingsPanel,
});
