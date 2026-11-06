import type {
  ShellSummary,
  WorkspaceDetail,
  WorkspaceSummary,
  WorkspaceWorktreeChoice,
} from "@t3tools/contracts";
import {
  FolderIcon,
  GitBranchIcon,
  GitForkIcon,
  ListChecksIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  LayersIcon,
  PlusIcon,
  SearchIcon,
  SquareTerminalIcon,
  TrashIcon,
  XIcon,
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
import { ManageWorktreesDialog } from "./ManageWorktreesDialog";
import { folderName, shellName } from "./shellName";
import { StartShellDialog } from "./StartShellDialog";
import { isActiveShell, worktreeLabel } from "./worktreeChoice";

const NEEDS_WORKSPACE = "Open a workspace first";

/** The app sidebar of the terminal-first screen: workspace actions and the shell tree. */
export function WorkspaceSidebar() {
  const view = useWorkspaces();
  const [creating, setCreating] = useState(false);
  const [dialog, setDialog] = useState<"start" | "add" | null>(null);
  // The folder whose repo-row "New worktree" button opened the dialog.
  const [newWorktreeIn, setNewWorktreeIn] = useState<string | null>(null);
  // The repository whose worktrees the "Manage worktrees" dialog shows.
  const [managing, setManaging] = useState<string | null>(null);
  // The tree row whose "+" is starting a shell, so a second click is ignored.
  const [startingRow, setStartingRow] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const act = async (action: Promise<string | null>) => setError(await action);
  // A new worktree only shows up in the folder's list once the workspace is read again.
  const startShell = async (folder: string, worktree: WorkspaceWorktreeChoice | null) => {
    const failure = await view.startShell(folder, worktree, null);
    if (failure === null && worktree?.kind === "new") void view.refresh();
    return failure;
  };
  const startInRow = async (
    row: string,
    folder: string,
    worktree: WorkspaceWorktreeChoice | null,
  ) => {
    if (startingRow !== null) return;
    setStartingRow(row);
    await act(startShell(folder, worktree));
    setStartingRow(null);
  };
  const savedWorkspaces = view.workspaces ?? [];
  const { shells } = useShells(view.environmentId);
  const openDialog = (which: "start" | "add") => {
    setDialog(which);
    // Folders deleted on disk since the workspace was opened must not be preselected.
    void act(view.refresh());
  };

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
                  tooltip={view.shown === null ? NEEDS_WORKSPACE : "Add a folder to the workspace"}
                  disabled={view.shown === null || !view.canChange}
                  onClick={() => openDialog("add")}
                >
                  <FolderPlusIcon />
                </SidebarHeaderIconButton>
                <SidebarHeaderIconButton
                  label="Start shell"
                  tooltip={view.shown === null ? NEEDS_WORKSPACE : "Start shell"}
                  disabled={view.shown === null || !view.canStartShell}
                  onClick={() => openDialog("start")}
                >
                  <PlusIcon />
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
              startingRow={startingRow}
              onStartIn={(row, folder, worktree) => void startInRow(row, folder, worktree)}
              onNewWorktree={(folder) => {
                setNewWorktreeIn(folder);
                void act(view.refresh());
              }}
              onManageWorktrees={(folder) => {
                setManaging(folder);
                // Worktrees made outside the app since the workspace was opened are listed too.
                void act(view.refresh());
              }}
              onHideWorktree={(folder, worktree) =>
                void act(view.setWorktreeVisible(folder, worktree, false))
              }
            />
          )}
        </SidebarGroup>
      </SidebarContent>
      <SidebarChromeFooter />
      <CreateWorkspaceDialog open={creating} onOpenChange={setCreating} onCreate={view.create} />
      {view.shown === null ? null : (
        <>
          <StartShellDialog
            key={`start:${view.shown.name}`}
            open={dialog === "start"}
            onOpenChange={(open) => setDialog(open ? "start" : null)}
            workspace={view.shown}
            loadGit={view.folderGit}
            onStart={startShell}
          />
          <StartShellDialog
            key={`new:${view.shown.name}:${newWorktreeIn ?? ""}`}
            open={newWorktreeIn !== null}
            onOpenChange={(open) => {
              if (!open) setNewWorktreeIn(null);
            }}
            workspace={view.shown}
            newWorktreeIn={newWorktreeIn}
            loadGit={view.folderGit}
            onStart={startShell}
          />
          <ManageWorktreesDialog
            folder={view.shown.folders.find((folder) => folder.path === managing) ?? null}
            onOpenChange={(open) => {
              if (!open) setManaging(null);
            }}
            onToggle={(worktree, visible) =>
              managing === null
                ? Promise.resolve(null)
                : view.setWorktreeVisible(managing, worktree, visible)
            }
          />
          <AddFolderDialog
            key={`add:${view.shown.name}`}
            open={dialog === "add"}
            onOpenChange={(open) => setDialog(open ? "add" : null)}
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

interface WorktreeNode {
  readonly path: string;
  readonly isPrimary: boolean;
  readonly branch: string | null;
  readonly head: string | null;
}

/**
 * The shown workspace, its folders, under each git folder every worktree (the primary one first)
 * with its shells, and the actions to start a shell in a worktree or create a new worktree.
 */
function ShellTree({
  workspace,
  shells,
  activeShellId,
  onChooseShell,
  canStart,
  startingRow,
  onStartIn,
  onNewWorktree,
  onManageWorktrees,
  onHideWorktree,
}: {
  readonly workspace: WorkspaceDetail;
  readonly shells: ReadonlyArray<ShellSummary>;
  readonly activeShellId: string | null;
  readonly onChooseShell: (shellId: ShellSummary["shellId"]) => void;
  readonly canStart: boolean;
  readonly startingRow: string | null;
  readonly onStartIn: (
    row: string,
    folder: string,
    worktree: WorkspaceWorktreeChoice | null,
  ) => void;
  readonly onNewWorktree: (folder: string) => void;
  readonly onManageWorktrees: (folder: string) => void;
  readonly onHideWorktree: (folder: string, worktree: string) => void;
}) {
  const shellRows = (inGroup: ReadonlyArray<ShellSummary>, level: number) =>
    inGroup.length === 0 ? null : (
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

  const startButton = (row: string, label: string, onClick: () => void) => (
    <SidebarHeaderIconButton
      label={label}
      disabled={!canStart || startingRow !== null}
      onClick={onClick}
    >
      <PlusIcon />
    </SidebarHeaderIconButton>
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
          const all = folder.worktrees ?? [];
          // A hidden worktree keeps its shells running, out of the tree.
          const hidden = new Set(all.filter((w) => !w.visible).map((w) => w.path));
          const inFolder = shells.filter(
            (shell) =>
              isActiveShell(shell) &&
              (shell.folder ?? shell.cwd) === folder.path &&
              (shell.worktree === null || !hidden.has(shell.worktree)),
          );
          const listed: ReadonlyArray<WorktreeNode> = all
            .filter((w) => w.visible)
            .map((worktree) => ({
              path: worktree.path,
              isPrimary: worktree.isMain,
              branch: worktree.branch,
              head: worktree.head,
            }));
          // A shell's worktree that the folder's list misses (removed, or the list failed) still
          // gets a node, so no shell is hidden.
          const extra = [
            ...new Set(
              inFolder.flatMap((shell) =>
                shell.worktree !== null && !listed.some((node) => node.path === shell.worktree)
                  ? [shell.worktree]
                  : [],
              ),
            ),
          ].map((path) => ({ path, isPrimary: path === folder.path, branch: null, head: null }));
          const nodes = [...listed, ...extra];
          const loose = inFolder.filter(
            (shell) =>
              shell.worktree === null || !nodes.some((node) => node.path === shell.worktree),
          );
          const isRepository = folder.worktrees !== null;
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
                {!folder.exists ? null : isRepository ? (
                  <>
                    <SidebarHeaderIconButton
                      label="Manage worktrees"
                      tooltip={`Choose which worktrees of ${folderName(folder.path)} to show`}
                      onClick={() => onManageWorktrees(folder.path)}
                    >
                      <ListChecksIcon />
                    </SidebarHeaderIconButton>
                    <SidebarHeaderIconButton
                      label="New worktree"
                      tooltip={`New worktree of ${folderName(folder.path)}`}
                      disabled={!canStart}
                      onClick={() => onNewWorktree(folder.path)}
                    >
                      <GitForkIcon />
                    </SidebarHeaderIconButton>
                  </>
                ) : (
                  startButton(folder.path, "Start shell here", () =>
                    onStartIn(
                      folder.path,
                      folder.path,
                      folder.isGitRepository ? { kind: "checkout" } : null,
                    ),
                  )
                )}
              </div>
              <div role="group" className="pl-2">
                {nodes.map((node) => {
                  const inWorktree = inFolder.filter((shell) => shell.worktree === node.path);
                  // A shell's polled branch is newer than the list read when the workspace opened.
                  const branch =
                    inWorktree.find((shell) => shell.branch !== null)?.branch ??
                    node.branch ??
                    (node.head === null ? null : node.head.slice(0, 7));
                  const label = worktreeLabel({
                    path: node.path,
                    isMain: node.isPrimary,
                    branch,
                    head: node.head ?? "",
                  });
                  return (
                    <div key={node.path} data-worktree={node.path}>
                      <div className="flex items-center gap-1 pr-1">
                        <div
                          role="treeitem"
                          aria-level={3}
                          aria-selected={false}
                          aria-label={node.path}
                          className="flex min-w-0 flex-1 items-center gap-1.5 truncate py-1 pl-4 text-sm text-sidebar-foreground"
                        >
                          <GitBranchIcon className="size-3.5 shrink-0 text-(--sidebar-icon-color)" />
                          <span className="truncate">{label}</span>
                        </div>
                        {startButton(node.path, `Start shell in ${label}`, () =>
                          onStartIn(
                            node.path,
                            folder.path,
                            node.isPrimary
                              ? { kind: "checkout" }
                              : { kind: "existing", path: node.path },
                          ),
                        )}
                        {all.some((w) => w.path === node.path) ? (
                          <SidebarHeaderIconButton
                            label={`Hide ${label}`}
                            tooltip="Hide this worktree and its shells (nothing is deleted)"
                            onClick={() => onHideWorktree(folder.path, node.path)}
                          >
                            <XIcon />
                          </SidebarHeaderIconButton>
                        ) : null}
                      </div>
                      {shellRows(inWorktree, 4)}
                    </div>
                  );
                })}
                {shellRows(loose, 3)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
