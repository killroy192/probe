import { ChevronDownIcon, FolderOpenIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import { useWorkspaces } from "../../state/workspaces";
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
      ) : (
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyTitle>No shells yet</EmptyTitle>
            <EmptyDescription>Shells you start in {view.shown.name} show here.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      <CreateWorkspaceDialog open={creating} onOpenChange={setCreating} onCreate={view.create} />
    </SidebarInset>
  );
}
