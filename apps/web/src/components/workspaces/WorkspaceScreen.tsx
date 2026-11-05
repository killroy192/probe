import type { EnvironmentId, ShellSummary } from "@t3tools/contracts";
import { ChevronDownIcon, FolderOpenIcon, PlusIcon, SquareTerminalIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "~/lib/utils";
import { useShells } from "../../state/shells";
import { useWorkspaces, type WorkspacesView } from "../../state/workspaces";
import { ShellTerminal } from "../ShellView";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Menu, MenuPopup, MenuTrigger } from "../ui/menu";
import { SidebarInset } from "../ui/sidebar";
import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog";
import { WorkspaceItems } from "./WorkspaceSidebar";

/** The main pane of the terminal-first screen: the start screen, or the shown workspace's shells. */
export function WorkspaceScreen() {
  const view = useWorkspaces();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <SidebarInset className="h-dvh min-h-0" data-testid="workspace-screen">
      {view.shown === null ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <Menu>
            <MenuTrigger render={<Button variant="outline" size="lg" />}>
              <FolderOpenIcon />
              Open workspace
              <ChevronDownIcon />
            </MenuTrigger>
            <MenuPopup>
              <WorkspaceItems
                workspaces={view.workspaces ?? []}
                onChoose={(name) => void view.open(name).then(setError)}
              />
            </MenuPopup>
          </Menu>
          {view.canChange ? (
            <Button size="lg" onClick={() => setCreating(true)}>
              <PlusIcon />
              Create workspace
            </Button>
          ) : null}
          {(error ?? view.listError) === null ? null : (
            <p role="alert" className="text-sm text-destructive-foreground">
              {error ?? view.listError}
            </p>
          )}
        </div>
      ) : view.tabs.shellIds.length === 0 || view.environmentId === null ? (
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyTitle>No shells yet</EmptyTitle>
            <EmptyDescription>Shells you start in {view.shown.name} show here.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ShellTabs environmentId={view.environmentId} view={view} />
      )}
      <CreateWorkspaceDialog open={creating} onOpenChange={setCreating} onCreate={view.create} />
    </SidebarInset>
  );
}

/** The shown workspace's shells as tabs; every tab stays mounted, only the active one shows. */
function ShellTabs({
  environmentId,
  view,
}: {
  readonly environmentId: EnvironmentId;
  readonly view: WorkspacesView;
}) {
  const { shells } = useShells(environmentId);
  const tabShells = view.tabs.shellIds.flatMap((id) => {
    const shell = shells?.find((candidate) => candidate.shellId === id);
    return shell === undefined ? [] : [shell];
  });
  const label = (shell: ShellSummary) => `${shell.label} · ${folderName(shell.cwd)}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div role="tablist" aria-label="Shells" className="flex shrink-0 gap-1 border-b px-2 pt-1">
        {tabShells.map((shell) => {
          const active = shell.shellId === view.tabs.activeShellId;
          return (
            <button
              key={shell.shellId}
              type="button"
              role="tab"
              aria-selected={active}
              data-shell-id={shell.shellId}
              onClick={() => view.activateShell(shell.shellId)}
              className={cn(
                "flex items-center gap-1.5 rounded-t-md border-b-2 px-3 py-1.5 text-xs",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <SquareTerminalIcon className="size-3.5" />
              {label(shell)}
            </button>
          );
        })}
      </div>
      {tabShells.map((shell) => {
        const active = shell.shellId === view.tabs.activeShellId;
        return (
          <div
            key={shell.shellId}
            role="tabpanel"
            aria-label={label(shell)}
            hidden={!active}
            data-testid={active ? "shell-view" : undefined}
            className="min-h-0 flex-1 p-2"
          >
            <ShellTerminal environmentId={environmentId} shell={shell} visible={active} />
          </div>
        );
      })}
    </div>
  );
}

const folderName = (path: string) =>
  path.split(/[\\/]/).findLast((part) => part.length > 0) ?? path;
