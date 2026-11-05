import { createFileRoute, redirect } from "@tanstack/react-router";
import { redirectHiddenChatRoute } from "../terminalFirst";

export const Route = createFileRoute("/projects/$projectKey")({
  beforeLoad: ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
    redirectHiddenChatRoute();
  },
});
