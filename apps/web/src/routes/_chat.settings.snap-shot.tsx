import { createFileRoute } from "@tanstack/react-router";

import { SnapShotSettings } from "../components/settings/SnapShotSettings";
import { redirectHiddenChatRoute } from "../terminalFirst";

function SettingsSnapShotRoute() {
  return <SnapShotSettings />;
}

export const Route = createFileRoute("/_chat/settings/snap-shot")({
  beforeLoad: redirectHiddenChatRoute,
  component: SettingsSnapShotRoute,
});
