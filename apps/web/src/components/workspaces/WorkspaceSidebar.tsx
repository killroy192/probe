import type { ShellSummary, WorkspaceDetail, WorkspaceSummary } from "@t3tools/contracts";
import {
  FolderIcon,
  GitBranchIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  LayersIcon,
  PlusIcon,
  SearchIcon,
  SquareTerminalIcon,
  TrashIcon,
} from "lucide-react";
import { useState } from "react";

import { isElectron } from "../../env";
import { useShells } from "../../state/shells";
import { useWorkspaces } from "../../state/workspaces";
import { SidebarChromeFooter, SidebarChromeHeader } from "../sidebar/SidebarChrome";
import { SidebarHeaderIconButton } from "../sidebar/SidebarThreadHeader";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import { SidebarContent, SidebarGroup, SidebarInput, SidebarMenuButton } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog";
import { AddFolderDialog } from "./AddFolderDialog";
import { folderName, shellName } from "./shellName";
import { StartShellDialog } from "./StartShellDialog";
import { isActiveShell, worktreeLabel } from "./worktreeChoice";

const NEEDS_WORKSPACE = "Open a workspace first";

/** The app sidebar of the terminal-first screen: workspace actions and the shell tree. */
export function WorkspaceSidebar() {
  const view = useWorkspaces();
  const [creating, setCreating] = useState(false);
  const [adding, setAdding] = useState(false);
  // The project whose "+" opened the create-shell dialog.
  const [creatingIn, setCreatingIn] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const act = async (action: Promise<string | null>) => setError(await action);
  const savedWorkspaces = view.workspaces ?? [];
  const { shells } = useShells(view.environmentId);

  return (
    <>
      <SidebarChromeHeader isElectron={isElectron} />
      <SidebarContent
        className="min-h-full"
        fixedHeader={
          <SidebarGroup className="z-[1]">
            <div className="flex items-center gap-1">
              <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-sidebar-muted-foreground">
                <SearchIcon className="size-4 shrink-0 text-(--sidebar-icon-color)" />
                <SidebarInput
                  nativeInput
                  type="search"
                  disabled
                  placeholder="Search shells"
                  aria-label="Search shells"
                  className="min-w-0 flex-1"
                />
              </div>
              <div className="flex shrink-0 items-center">
                <SidebarHeaderIconButton
                  label="Add project"
                  tooltip={view.shown === null ? NEEDS_WORKSPACE : "Add a project to the workspace"}
                  disabled={view.shown === null || !view.canChange}
                  onClick={() => setAdding(true)}
                >
                  <FolderPlusIcon />
                </SidebarHeaderIconButton>
                <Menu>
                  <MenuTrigger
                    render={
                      <SidebarMenuButton
                        size="icon"
                        aria-label="Workspaces"
                        className="size-7 shrink-0"
                      />
                    }
                  >
                    <LayersIcon />
                  </MenuTrigger>
                  <MenuPopup align="end">
                    {view.canChange ? (
                      <MenuItem onClick={() => setCreating(true)}>
                        <PlusIcon />
                        Create workspace
                      </MenuItem>
                    ) : null}
                    <MenuSub>
                      <MenuSubTrigger>
                        <FolderOpenIcon />
                        Open workspace
                      </MenuSubTrigger>
                      <MenuSubPopup>
                        <WorkspaceItems
                          workspaces={savedWorkspaces}
                          onChoose={(name) => void act(view.open(name))}
                        />
                      </MenuSubPopup>
                    </MenuSub>
                    {view.canChange ? (
                      <MenuSub>
                        <MenuSubTrigger>
                          <TrashIcon />
                          Remove workspace
                        </MenuSubTrigger>
                        <MenuSubPopup>
                          <WorkspaceItems
                            workspaces={savedWorkspaces}
                            onChoose={(name) => void act(view.remove(name))}
                          />
                        </MenuSubPopup>
                      </MenuSub>
                    ) : null}
                  </MenuPopup>
                </Menu>
              </div>
            </div>
            {error === null ? null : (
              <p role="alert" className="px-2 pt-1 text-xs text-destructive-foreground">
                {error}
              </p>
            )}
          </SidebarGroup>
        }
      >
        <SidebarGroup>
          {view.shown === null ? null : (
            <ShellTree
              workspace={view.shown}
              shells={shells ?? []}
              activeShellId={view.tabs.activeShellId}
              onChooseShell={view.activateShell}
              canStart={view.canStartShell}
              onCreateShell={(folder) => {
                setCreatingIn(folder);
                // A project deleted on disk since the workspace was opened shows as missing.
                void act(view.refresh());
              }}
            />
          )}
        </SidebarGroup>
      </SidebarContent>
      <SidebarChromeFooter />
      <CreateWorkspaceDialog open={creating} onOpenChange={setCreating} onCreate={view.create} />
      {view.shown === null ? null : (
        <>
          <StartShellDialog
            key={`create:${view.shown.name}:${creatingIn ?? ""}`}
            folder={
              view.shown.folders.find((folder) => folder.path === creatingIn && folder.exists) ??
              null
            }
            onOpenChange={(open) => {
              if (!open) setCreatingIn(null);
            }}
            workspace={view.shown}
            loadGit={view.folderGit}
            onStart={(folder, worktree) => view.startShell(folder, worktree, null)}
          />
          <AddFolderDialog
            key={`add:${view.shown.name}`}
            open={adding}
            onOpenChange={setAdding}
            environmentId={view.environmentId}
            workspaceName={view.shown.name}
            onAddFolder={view.addFolder}
          />
        </>
      )}
    </>
  );
}

/** Saved workspaces as menu items, or a disabled note when there are none. */
export function WorkspaceItems({
  workspaces,
  onChoose,
}: {
  readonly workspaces: ReadonlyArray<WorkspaceSummary>;
  readonly onChoose: (name: string) => void;
}) {
  if (workspaces.length === 0) return <MenuItem disabled>No saved workspaces</MenuItem>;
  return workspaces.map((workspace) => (
    <MenuItem key={workspace.name} onClick={() => onChoose(workspace.name)}>
      {workspace.name}
    </MenuItem>
  ));
}

/** Shells grouped by the worktree they started in, in first-start order; null holds non-git ones. */
function byWorktree(shells: ReadonlyArray<ShellSummary>) {
  const groups = new Map<string | null, ShellSummary[]>();
  for (const shell of shells) {
    const group = groups.get(shell.worktree);
    if (group === undefined) groups.set(shell.worktree, [shell]);
    else group.push(shell);
  }
  return [...groups];
}

/**
 * The shown workspace, its projects with a "+" to create a shell, and under each project the
 * worktrees that have shells (labelled with their current branch) and those shells.
 */
function ShellTree({
  workspace,
  shells,
  activeShellId,
  onChooseShell,
  canStart,
  onCreateShell,
}: {
  readonly workspace: WorkspaceDetail;
  readonly shells: ReadonlyArray<ShellSummary>;
  readonly activeShellId: string | null;
  readonly onChooseShell: (shellId: ShellSummary["shellId"]) => void;
  readonly canStart: boolean;
  readonly onCreateShell: (folder: string) => void;
}) {
  const shellRows = (inGroup: ReadonlyArray<ShellSummary>, level: number) => (
    <div role="group" className="pl-4">
      {inGroup.map((shell) => (
        <SidebarMenuButton
          key={shell.shellId}
          role="treeitem"
          aria-level={level}
          aria-selected={shell.shellId === activeShellId}
          isActive={shell.shellId === activeShellId}
          data-shell-id={shell.shellId}
          onClick={() => onChooseShell(shell.shellId)}
        >
          <SquareTerminalIcon />
          <span className="truncate">{shellName(shell, { folder: false })}</span>
          {shell.elsewhere === null ? null : (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span
                    data-elsewhere={shell.elsewhere}
                    className="ml-auto shrink-0 text-xs text-muted-foreground"
                  />
                }
              >
                elsewhere
              </TooltipTrigger>
              <TooltipPopup side="right">Now in {shell.elsewhere}</TooltipPopup>
            </Tooltip>
          )}
        </SidebarMenuButton>
      ))}
    </div>
  );

  return (
    <div role="tree" aria-label="Shell tree">
      <div
        role="treeitem"
        aria-level={1}
        aria-selected={false}
        aria-expanded
        className="truncate px-2 py-1 text-sm font-medium text-sidebar-foreground"
      >
        {workspace.name}
      </div>
      <div role="group">
        {workspace.folders.map((folder) => {
          // Shells from before folders were recorded fall back to their starting folder.
          const inFolder = shells.filter(
            (shell) => isActiveShell(shell) && (shell.folder ?? shell.cwd) === folder.path,
          );
          return (
            <div key={folder.path} data-folder={folder.path}>
              <div className="flex items-center gap-1 pr-1">
                <div
                  role="treeitem"
                  aria-level={2}
                  aria-selected={false}
                  aria-label={folder.path}
                  className="flex min-w-0 flex-1 items-center gap-1.5 truncate py-1 pl-4 text-sm text-sidebar-foreground"
                >
                  <FolderIcon className="size-3.5 shrink-0 text-(--sidebar-icon-color)" />
                  <span className="truncate">{folderName(folder.path)}</span>
                  {folder.exists ? null : (
                    <span className="shrink-0 text-xs text-muted-foreground">missing</span>
                  )}
                </div>
                {folder.exists ? (
                  <SidebarHeaderIconButton
                    label={`Create shell in ${folderName(folder.path)}`}
                    tooltip="Create shell"
                    disabled={!canStart}
                    onClick={() => onCreateShell(folder.path)}
                  >
                    <PlusIcon />
                  </SidebarHeaderIconButton>
                ) : null}
              </div>
              {inFolder.length === 0 ? null : (
                <div role="group" className="pl-2">
                  {byWorktree(inFolder).map(([worktree, inWorktree]) =>
                    worktree === null ? (
                      <div key="no-worktree">{shellRows(inWorktree, 3)}</div>
                    ) : (
                      <div key={worktree} data-worktree={worktree}>
                        <div
                          role="treeitem"
                          aria-level={3}
                          aria-selected={false}
                          aria-label={worktree}
                          className="flex items-center gap-1.5 truncate py-1 pr-2 pl-4 text-sm text-sidebar-foreground"
                        >
                          <GitBranchIcon className="size-3.5 shrink-0 text-(--sidebar-icon-color)" />
                          <span className="truncate">
                            {worktreeLabel({
                              path: worktree,
                              isMain: worktree === folder.path,
                              branch:
                                inWorktree.find((shell) => shell.branch !== null)?.branch ?? null,
                              head: "",
                            })}
                          </span>
                        </div>
                        {shellRows(inWorktree, 4)}
                      </div>
                    ),
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
