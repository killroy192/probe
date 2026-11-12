import type { ShellSummary, WorkspaceDetail, WorkspaceSummary } from "@t3tools/contracts";
import {
  FolderIcon,
  FolderMinusIcon,
  GitBranchIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  LayersIcon,
  PlusIcon,
  RotateCcwIcon,
  SearchIcon,
  SquareTerminalIcon,
  TrashIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";

import { requestConfirmDialog } from "../../confirmDialog";
import { isElectron } from "../../env";
import { useRestoredMarks, useShells } from "../../state/shells";
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
import { AddProjectDialog } from "./AddProjectDialog";
import { folderName, shellName } from "./shellName";
import { StartShellDialog } from "./StartShellDialog";
import { isListedShell, isRunningShell, worktreeLabel } from "./worktreeChoice";
import { focusShell } from "../ShellView";

const NEEDS_WORKSPACE = "Open a workspace first";

/** Asks before removing a project; its running shells are killed with it. */
const confirmRemoveProject = async (project: string, workspace: string, running: number) =>
  (await requestConfirmDialog(
    [
      `Remove ${folderName(project)} from ${workspace}?`,
      ...(running === 0
        ? []
        : [`Its ${running === 1 ? "running shell is" : `${running} running shells are`} killed.`]),
      "The folder stays on disk.",
    ].join("\n"),
    { variant: "destructive" },
  )) === true;

/** Asks before a kill; a worktree the shell started in is never deleted with it. */
const confirmKill = async (shell: ShellSummary) =>
  (await requestConfirmDialog(
    [
      shell.ended === null
        ? `Kill ${shellName(shell, { folder: false })}?`
        : `Remove ${shellName(shell, { folder: false })}?`,
      shell.ended === null
        ? "Its process and everything it started end now."
        : "It has ended; it leaves the tree for good. Restore it instead to start it again.",
      ...(shell.worktree === null ? [] : ["Its worktree stays on disk."]),
    ].join("\n"),
    { variant: "destructive" },
  )) === true;

const ENDED_REASON = {
  signal: "A signal ended this shell.",
  lost: "This shell was lost when the process that held it ended, for example in a reboot.",
} as const;

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
  const restoredMarks = useRestoredMarks(view.environmentId);

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
                    {view.canChange || !view.canChangeKnown ? (
                      <MenuItem disabled={!view.canChange} onClick={() => setCreating(true)}>
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
            {view.layoutError === null ? null : (
              <p role="alert" className="px-2 pt-1 text-xs text-destructive-foreground">
                {view.layoutError}
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
              restoredMarks={restoredMarks}
              activeShellId={view.tabs.activeShellId}
              onChooseShell={(shellId) => {
                view.activateShell(shellId);
                if (view.environmentId !== null) focusShell(view.environmentId, shellId);
              }}
              canStart={view.canStartShell}
              onCreateShell={(project) => {
                setCreatingIn(project);
                // A project deleted on disk since the workspace was opened shows as missing.
                void act(view.refresh());
              }}
              canRemoveProject={view.canChange}
              onRemoveProject={(project, running) =>
                void confirmRemoveProject(project, view.shown?.name ?? "", running).then(
                  (confirmed) => (confirmed ? act(view.removeProject(project)) : undefined),
                )
              }
              onRestoreShell={(shell) => void act(view.restoreShell(shell.shellId))}
              onKillShell={(shell) =>
                void confirmKill(shell).then((confirmed) =>
                  confirmed ? act(view.killShell(shell.shellId)) : undefined,
                )
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
            key={`create:${view.shown.name}:${creatingIn ?? ""}`}
            // Stays open on a folder found deleted meanwhile, so its refused start can say why.
            project={view.shown.projects.find((project) => project.path === creatingIn) ?? null}
            onOpenChange={(open) => {
              if (!open) setCreatingIn(null);
            }}
            workspace={view.shown}
            loadGit={view.projectGit}
            loadScripts={view.startingScripts}
            onStart={(project, worktree, script) =>
              view.startShell(project, worktree, script, null)
            }
          />
          <AddProjectDialog
            key={`add:${view.shown.name}`}
            open={adding}
            onOpenChange={setAdding}
            environmentId={view.environmentId}
            workspaceName={view.shown.name}
            onAddProject={view.addProject}
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
/** A project's folder, worktree or shell's folder that is gone from where it was: moved or deleted. */
function MovedMark({ path }: { readonly path: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span data-missing className="ml-auto shrink-0 text-xs text-destructive-foreground" />
        }
      >
        moved
      </TooltipTrigger>
      <TooltipPopup side="right">Not found at {path}; it was moved or deleted.</TooltipPopup>
    </Tooltip>
  );
}

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
  restoredMarks,
  activeShellId,
  onChooseShell,
  canStart,
  onCreateShell,
  onKillShell,
  onRestoreShell,
  canRemoveProject,
  onRemoveProject,
}: {
  readonly workspace: WorkspaceDetail;
  readonly shells: ReadonlyArray<ShellSummary>;
  readonly restoredMarks: ReadonlySet<ShellSummary["shellId"]>;
  readonly activeShellId: string | null;
  readonly onChooseShell: (shellId: ShellSummary["shellId"]) => void;
  readonly canStart: boolean;
  readonly onCreateShell: (project: string) => void;
  readonly onKillShell: (shell: ShellSummary) => void;
  readonly onRestoreShell: (shell: ShellSummary) => void;
  readonly canRemoveProject: boolean;
  /** `running` is how many of the workspace's running shells the removal kills. */
  readonly onRemoveProject: (project: string, running: number) => void;
}) {
  const shellRows = (inGroup: ReadonlyArray<ShellSummary>, level: number) => (
    <div role="group" className="pl-4">
      {inGroup.map((shell) => (
        <div
          key={shell.shellId}
          data-shell-row={shell.shellId}
          className="group/shell flex items-center gap-1 pr-1"
        >
          <SidebarMenuButton
            role="treeitem"
            aria-level={level}
            aria-selected={shell.shellId === activeShellId}
            aria-disabled={shell.ended !== null}
            isActive={shell.shellId === activeShellId}
            data-shell-id={shell.shellId}
            data-ended={shell.ended ?? undefined}
            // An ended shell has no terminal to show; it can be restored or removed.
            onClick={() => (shell.ended === null ? onChooseShell(shell.shellId) : undefined)}
          >
            <SquareTerminalIcon />
            <span className={shell.ended === null ? "truncate" : "truncate text-muted-foreground"}>
              {shellName(shell, { folder: false })}
            </span>
            {restoredMarks.has(shell.shellId) ? (
              <span data-restored className="ml-auto shrink-0 text-xs text-muted-foreground">
                restored
              </span>
            ) : null}
            {shell.ended === null ? null : (
              <Tooltip>
                <TooltipTrigger
                  render={<span className="ml-auto shrink-0 text-xs text-muted-foreground" />}
                >
                  ended
                </TooltipTrigger>
                <TooltipPopup side="right">{ENDED_REASON[shell.ended]}</TooltipPopup>
              </Tooltip>
            )}
            {shell.missing ? (
              <MovedMark path={shell.worktree ?? shell.project ?? shell.cwd} />
            ) : null}
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
          {/* Shown on hover; a pointer reaches it by hovering the row first. */}
          <span className="flex opacity-0 group-hover/shell:opacity-100 focus-within:opacity-100">
            {shell.ended === null || shell.missing ? null : (
              <SidebarHeaderIconButton
                label={`Restore ${shellName(shell, { folder: false })}`}
                tooltip="Restore shell"
                disabled={!canStart}
                onClick={() => onRestoreShell(shell)}
              >
                <RotateCcwIcon />
              </SidebarHeaderIconButton>
            )}
            <SidebarHeaderIconButton
              label={`${shell.ended === null ? "Kill" : "Remove"} ${shellName(shell, { folder: false })}`}
              tooltip={shell.ended === null ? "Kill shell" : "Remove shell"}
              disabled={!canStart}
              onClick={() => onKillShell(shell)}
            >
              <XIcon />
            </SidebarHeaderIconButton>
          </span>
        </div>
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
        {workspace.projects.map((project) => {
          // Shells from before projects were recorded fall back to their starting folder.
          const inProject = shells.filter(
            (shell) => isListedShell(shell) && (shell.project ?? shell.cwd) === project.path,
          );
          const running = inProject.filter(isRunningShell).length;
          return (
            <div key={project.path} data-project={project.path}>
              <div className="group/project flex items-center gap-1 pr-1">
                <div
                  role="treeitem"
                  aria-level={2}
                  aria-selected={false}
                  aria-label={project.path}
                  className="flex min-w-0 flex-1 items-center gap-1.5 truncate py-1 pl-4 text-sm text-sidebar-foreground"
                >
                  <FolderIcon className="size-3.5 shrink-0 text-(--sidebar-icon-color)" />
                  <span className="truncate">{folderName(project.path)}</span>
                  {project.exists ? null : <MovedMark path={project.path} />}
                </div>
                {/* Shown on hover, also for a missing project, so it can be taken out. */}
                <span className="opacity-0 group-hover/project:opacity-100 focus-within:opacity-100">
                  <SidebarHeaderIconButton
                    label={`Remove ${folderName(project.path)} from the workspace`}
                    tooltip="Remove project"
                    disabled={!canRemoveProject}
                    onClick={() => onRemoveProject(project.path, running)}
                  >
                    <FolderMinusIcon />
                  </SidebarHeaderIconButton>
                </span>
                {project.exists ? (
                  <SidebarHeaderIconButton
                    label={`Create shell in ${folderName(project.path)}`}
                    tooltip="Create shell"
                    disabled={!canStart}
                    onClick={() => onCreateShell(project.path)}
                  >
                    <PlusIcon />
                  </SidebarHeaderIconButton>
                ) : null}
              </div>
              {inProject.length === 0 ? null : (
                <div role="group" className="pl-2">
                  {byWorktree(inProject).map(([worktree, inWorktree]) =>
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
                              isMain: worktree === project.path,
                              branch:
                                inWorktree.find((shell) => shell.branch !== null)?.branch ?? null,
                              head: "",
                            })}
                          </span>
                          {worktree !== project.path &&
                          inWorktree.some((shell) => shell.missing) ? (
                            <MovedMark path={worktree} />
                          ) : null}
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
