import { createFileRoute } from "@tanstack/react-router";
import { ProjectsSettings } from "../components/settings/ProjectsSettings";
import { redirectHiddenChatRoute } from "../terminalFirst";

export const Route = createFileRoute("/_chat/settings/projects")({
  beforeLoad: redirectHiddenChatRoute,
  component: ProjectsSettings,
});
