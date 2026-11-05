import { createFileRoute } from "@tanstack/react-router";

import { UsagePage } from "../components/usage/UsagePage";
import { redirectHiddenChatRoute } from "../terminalFirst";

export const Route = createFileRoute("/_chat/usage")({
  beforeLoad: redirectHiddenChatRoute,
  component: UsagePage,
});
