import type { ShellSummary, WorkspaceDetail, WorkspaceSummary } from "@t3tools/contracts";
import {
  FolderIcon,
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
import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog";
import { StartShellDialog } from "./StartShellDialog";

const NEEDS_WORKSPACE = "Open a workspace first";

/** The app sidebar of the terminal-first screen: workspace actions and the shell tree. */
export function WorkspaceSidebar() {
  const view = useWorkspaces();
  const [creating, setCreating] = useState(false);
  // "start" opens the folder list; "add" opens it on "Add folder".
  const [starting, setStarting] = useState<"start" | "add" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const act = async (action: Promise<string | null>) => setError(await action);
  const savedWorkspaces = view.workspaces ?? [];
  const { shells } = useShells(view.environmentId);
  const openStart = (mode: "start" | "add") => {
    setStarting(mode);
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
                  onClick={() => openStart("add")}
                >
                  <FolderPlusIcon />
                </SidebarHeaderIconButton>
                <SidebarHeaderIconButton
                  label="Start shell"
                  tooltip={view.shown === null ? NEEDS_WORKSPACE : "Start shell"}
                  disabled={view.shown === null || !view.canStartShell}
                  onClick={() => openStart("start")}
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
            />
          )}
        </SidebarGroup>
      </SidebarContent>
      <SidebarChromeFooter />
      <CreateWorkspaceDialog open={creating} onOpenChange={setCreating} onCreate={view.create} />
      {view.shown === null ? null : (
        <StartShellDialog
          key={view.shown.name}
          open={starting !== null}
          initialAdding={starting === "add"}
          onOpenChange={(open) => {
            if (!open) setStarting(null);
          }}
          environmentId={view.environmentId}
          workspace={view.shown}
          canAddFolder={view.canChange}
          onAddFolder={view.addFolder}
          onStart={(folder) => view.startShell(folder, null)}
        />
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

/** The shown workspace, its folders, and under each folder the shells started in it. */
function ShellTree({
  workspace,
  shells,
  activeShellId,
  onChooseShell,
}: {
  readonly workspace: WorkspaceDetail;
  readonly shells: ReadonlyArray<ShellSummary>;
  readonly activeShellId: string | null;
  readonly onChooseShell: (shellId: ShellSummary["shellId"]) => void;
}) {
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
          const inFolder = shells.filter((shell) => shell.cwd === folder.path);
          return (
            <div key={folder.path} data-folder={folder.path}>
              <div
                role="treeitem"
                aria-level={2}
                aria-selected={false}
                aria-label={folder.path}
                className="flex items-center gap-1.5 truncate py-1 pr-2 pl-4 text-sm text-sidebar-foreground"
              >
                <FolderIcon className="size-3.5 shrink-0 text-(--sidebar-icon-color)" />
                <span className="truncate">{folderLabel(folder.path)}</span>
              </div>
              {inFolder.length === 0 ? null : (
                <div role="group" className="pl-6">
                  {inFolder.map((shell) => (
                    <SidebarMenuButton
                      key={shell.shellId}
                      role="treeitem"
                      aria-level={3}
                      aria-selected={shell.shellId === activeShellId}
                      isActive={shell.shellId === activeShellId}
                      data-shell-id={shell.shellId}
                      onClick={() => onChooseShell(shell.shellId)}
                    >
                      <SquareTerminalIcon />
                      <span className="truncate">{shell.label}</span>
                    </SidebarMenuButton>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const folderLabel = (path: string) =>
  path.split(/[\\/]/).findLast((part) => part.length > 0) ?? path;
