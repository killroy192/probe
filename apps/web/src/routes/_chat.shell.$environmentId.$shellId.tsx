import { createFileRoute } from "@tanstack/react-router";
import type { EnvironmentId, ShellId } from "@t3tools/contracts";

import { ShellView } from "../components/ShellView";

// A direct address for a standalone shell until the workspace tree lists them.
export const Route = createFileRoute("/_chat/shell/$environmentId/$shellId")({
  component: ShellRoute,
});

function ShellRoute() {
  const { environmentId, shellId } = Route.useParams();
  return (
    <ShellView
      key={`${environmentId}:${shellId}`}
      environmentId={environmentId as EnvironmentId}
      shellId={shellId as ShellId}
    />
  );
}
