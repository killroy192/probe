import { createFileRoute } from "@tanstack/react-router";
import { validateScheduledTasksSearch } from "../components/settings/scheduledTasksSettings.logic";

import { ScheduledTasksSettings } from "../components/settings/ScheduledTasksSettings";
import { redirectHiddenChatRoute } from "../terminalFirst";

function SettingsScheduledTasksRoute() {
  const target = Route.useSearch();
  return <ScheduledTasksSettings {...target} />;
}

export const Route = createFileRoute("/_chat/settings/scheduled-tasks")({
  beforeLoad: redirectHiddenChatRoute,
  validateSearch: validateScheduledTasksSearch,
  component: SettingsScheduledTasksRoute,
});
