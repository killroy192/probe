import type { WorkspaceSummary } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDownIcon, FolderOpenIcon, PlusIcon, SettingsIcon, TrashIcon } from "lucide-react";
import { useState } from "react";

import { useWorkspaces } from "../../state/workspaces";
import { Button } from "../ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog";

/** The terminal-first main screen: the start screen, or the shown workspace's tree. */
export function WorkspaceScreen() {
  const view = useWorkspaces();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (action: Promise<string | null>) => {
    setError(await action);
  };
  const open = (name: string) => void act(view.open(name));
  const savedWorkspaces = view.workspaces ?? [];

  return (
    <main
      className="flex h-dvh min-h-0 w-full flex-col bg-background"
      data-testid="workspace-screen"
    >
      {view.shown === null ? null : (
        <header className="flex items-center gap-2 border-b px-3 py-2">
          <Menu>
            <MenuTrigger render={<Button variant="ghost" size="sm" />}>
              Workspaces
              <ChevronDownIcon />
            </MenuTrigger>
            <MenuPopup align="start">
              <MenuItem onClick={() => setCreating(true)}>
                <PlusIcon />
                Create workspace
              </MenuItem>
              <MenuSub>
                <MenuSubTrigger>
                  <FolderOpenIcon />
                  Open workspace
                </MenuSubTrigger>
                <MenuSubPopup>
                  <WorkspaceItems workspaces={savedWorkspaces} onChoose={open} />
                </MenuSubPopup>
              </MenuSub>
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
              <MenuSeparator />
              <MenuItem onClick={() => void navigate({ to: "/settings" })}>
                <SettingsIcon />
                Settings
              </MenuItem>
            </MenuPopup>
          </Menu>
        </header>
      )}
      {error === null && view.listError === null ? null : (
        <p role="alert" className="mx-3 mt-3 text-sm text-destructive-foreground">
          {error ?? view.listError}
        </p>
      )}
      {view.shown === null ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <Menu>
            <MenuTrigger render={<Button variant="outline" size="lg" />}>
              <FolderOpenIcon />
              Open workspace
              <ChevronDownIcon />
            </MenuTrigger>
            <MenuPopup>
              <WorkspaceItems workspaces={savedWorkspaces} onChoose={open} />
            </MenuPopup>
          </Menu>
          <Button size="lg" onClick={() => setCreating(true)}>
            <PlusIcon />
            Create workspace
          </Button>
        </div>
      ) : (
        <ShellTree workspace={view.shown} />
      )}
      <CreateWorkspaceDialog open={creating} onOpenChange={setCreating} onCreate={view.create} />
    </main>
  );
}

function WorkspaceItems({
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

/** The workspace is the tree's root; folders and shells join it in later stories. */
function ShellTree({ workspace }: { readonly workspace: WorkspaceSummary }) {
  return (
    <div role="tree" aria-label="Shell tree" className="p-3">
      <div role="treeitem" aria-level={1} aria-selected={false} className="text-sm font-medium">
        {workspace.name}
      </div>
    </div>
  );
}
