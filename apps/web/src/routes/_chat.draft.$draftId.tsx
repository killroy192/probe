import { createFileRoute } from "@tanstack/react-router";
import { redirectHiddenChatRoute } from "../terminalFirst";

// The _chat layout owns ChatView so draft promotion keeps it mounted.
export const Route = createFileRoute("/_chat/draft/$draftId")({
  beforeLoad: redirectHiddenChatRoute,
  component: () => null,
});
