import { shellPromptState } from "@t3tools/client-runtime/state/terminal";
import type { EnvironmentId, ShellSummary } from "@t3tools/contracts";
import { ChevronDownIcon, FolderOpenIcon, PlusIcon, SquareTerminalIcon } from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";

import { cn } from "~/lib/utils";
import { useShells } from "../../state/shells";
import { useWorkspaces, type WorkspacesView } from "../../state/workspaces";
import { isElectron } from "../../env";
import { focusShell, ShellTerminal } from "../ShellView";
import { shellName } from "./shellName";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { Button } from "../ui/button";
import { PanelTabCloseButton } from "../ui/panel-tab-close-button";
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
  const { restoreShown } = view;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Reads browser storage once the workspace list arrives, to show the workspace a reload left.
  useEffect(() => restoreShown(), [restoreShown]);
  // `_changed` names what prompted the read, so an effect can depend on it.
  const refresh = useEffectEvent((_changed?: string) => void view.refresh());
  const { shells } = useShells(view.environmentId);
  const notFound = (shells ?? [])
    .filter((shell) => shell.missing)
    .map((shell) => shell.shellId)
    .join(",");
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- A shell's folder gone from disk, or its last shell there gone, changes the project's state on the server; read it again.
  useEffect(() => {
    refresh(notFound);
  }, [notFound]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Folders change on disk outside the app; coming back to the window reads the projects again.
  useEffect(() => {
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  return (
    <SidebarInset
      className="h-dvh min-h-0"
      data-testid="workspace-screen"
      // Whether the shown workspace's tabs, as this page last changed them, reached the server.
      data-layout-save={view.shown === null ? undefined : view.layoutSave}
    >
      {view.shown === null && view.restoring ? null : view.shown === null ? (
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
            <EmptyTitle>No open shells</EmptyTitle>
            <EmptyDescription>
              Start a shell with + on a project in {view.shown.name}, or open one from the tree.
            </EmptyDescription>
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
  const label = (shell: ShellSummary) => shellName(shell, { folder: true });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The page header leaves room for the sidebar toggle when the sidebar is collapsed. */}
      <WorkspacePageHeader electron={isElectron} className="border-b">
        <div role="tablist" aria-label="Shells" className="flex h-full min-w-0 items-end gap-1">
          {tabShells.map((shell) => {
            const active = shell.shellId === view.tabs.activeShellId;
            return (
              <div
                key={shell.shellId}
                className={cn(
                  "group/tab flex items-center gap-1.5 rounded-t-md border-b-2 px-3 py-1.5 text-xs",
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {/* Closing only hides the tab; the shell keeps running in the tree. */}
                <PanelTabCloseButton
                  label={`Close ${label(shell)}`}
                  tooltip="Close tab"
                  onClick={() => view.closeTab(shell.shellId)}
                >
                  <SquareTerminalIcon className="size-3.5" />
                </PanelTabCloseButton>
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  data-shell-id={shell.shellId}
                  onClick={() => {
                    view.activateShell(shell.shellId);
                    focusShell(environmentId, shell.shellId);
                  }}
                  className="cursor-pointer"
                >
                  {label(shell)}
                </button>
              </div>
            );
          })}
        </div>
      </WorkspacePageHeader>
      {tabShells.map((shell) => {
        const active = shell.shellId === view.tabs.activeShellId;
        return (
          <div
            key={shell.shellId}
            role="tabpanel"
            aria-label={label(shell)}
            data-shell-id={shell.shellId}
            // The surface inside says whether it is attached; this says whether the shell is ready.
            data-shell-ready={shellPromptState(shell)}
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
