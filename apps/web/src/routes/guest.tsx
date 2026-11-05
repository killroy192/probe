import { createFileRoute } from "@tanstack/react-router";

import { GuestPage } from "../components/guest/GuestPage";
import { redirectHiddenChatRoute } from "../terminalFirst";

export const Route = createFileRoute("/guest")({
  // A guest link shows a shared chat thread, so it is hidden with the rest of chat.
  beforeLoad: redirectHiddenChatRoute,
  component: GuestPage,
});
