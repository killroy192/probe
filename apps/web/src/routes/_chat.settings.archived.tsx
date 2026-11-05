import { createFileRoute } from "@tanstack/react-router";

import { ArchivedThreadsPanel } from "../components/settings/ArchivedThreadsPanel";
import { redirectHiddenChatRoute } from "../terminalFirst";

export const Route = createFileRoute("/_chat/settings/archived")({
  beforeLoad: redirectHiddenChatRoute,
  component: ArchivedThreadsPanel,
});
