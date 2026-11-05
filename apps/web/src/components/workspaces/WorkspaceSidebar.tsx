import type { WorkspaceSummary } from "@t3tools/contracts";
import {
  FolderOpenIcon,
  FolderPlusIcon,
  LayersIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
} from "lucide-react";
import { useState } from "react";

import { isElectron } from "../../env";
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

// Shells and folders arrive in story 4; until then search and add project are shown but disabled.
const COMING_WITH_SHELLS = "Available once workspaces hold folders and shells";

/** The app sidebar of the terminal-first screen: workspace actions and the shell tree. */
export function WorkspaceSidebar() {
  const view = useWorkspaces();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (action: Promise<string | null>) => setError(await action);
  const savedWorkspaces = view.workspaces ?? [];

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
                <SidebarHeaderIconButton label="Add project" tooltip={COMING_WITH_SHELLS} disabled>
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
            <div role="tree" aria-label="Shell tree">
              <div
                role="treeitem"
                aria-level={1}
                aria-selected={false}
                className="truncate px-2 py-1 text-sm font-medium text-sidebar-foreground"
              >
                {view.shown.name}
              </div>
            </div>
          )}
        </SidebarGroup>
      </SidebarContent>
      <SidebarChromeFooter />
      <CreateWorkspaceDialog open={creating} onOpenChange={setCreating} onCreate={view.create} />
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
