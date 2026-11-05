import type { WorkspaceDetail } from "@t3tools/contracts";
import { ArrowUpIcon, FolderIcon } from "lucide-react";
import { useState } from "react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Radio, RadioGroup } from "../ui/radio-group";
import { useDialogAction } from "./dialogAction";

/**
 * Picks one of the workspace's folders and starts an agent shell in it. Folders gone from disk
 * are not offered. The dialog stays open with the server's reason when the shell cannot start.
 */
export function StartShellDialog({
  open,
  onOpenChange,
  workspace,
  onStart,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly workspace: WorkspaceDetail;
  readonly onStart: (folder: string) => Promise<string | null>;
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  const action = useDialogAction();

  const folders = workspace.folders.filter((folder) => folder.exists);
  const folderPaths = folders.map((folder) => folder.path);
  // The remembered folder is offered only while it is still in this workspace (AC-14, AC-25).
  const selected =
    chosen !== null && folderPaths.includes(chosen)
      ? chosen
      : workspace.lastFolder !== null && folderPaths.includes(workspace.lastFolder)
        ? workspace.lastFolder
        : null;

  const close = (next: boolean) => {
    if (!action.canClose()) return;
    if (!next) {
      setChosen(null);
      action.clearError();
    }
    onOpenChange(next);
  };

  const start = async () => {
    if (selected === null) return;
    if (await action.run(() => onStart(selected))) {
      setChosen(null);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogPopup className="max-w-lg">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void start();
          }}
        >
          <DialogHeader>
            <DialogTitle>Start shell</DialogTitle>
            <DialogDescription>
              Pick a folder in {workspace.name}. The agent starts in a new shell there.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            {/* A single shrinkable column, so a long folder path truncates instead of scrolling. */}
            <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
              {folders.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  This workspace has no folders yet. Add one with Add project in the sidebar.
                </p>
              ) : (
                <RadioGroup
                  aria-label="Folders"
                  value={selected ?? ""}
                  onValueChange={(value) => {
                    setChosen(String(value));
                    action.clearError();
                  }}
                >
                  {folders.map((folder) => (
                    <label
                      key={folder.path}
                      className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/50"
                    >
                      <Radio value={folder.path} aria-label={folder.path} />
                      <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate font-mono text-xs">
                        {folder.path}
                      </span>
                      {folder.isGitRepository ? <Badge variant="outline">git</Badge> : null}
                    </label>
                  ))}
                </RadioGroup>
              )}
              {action.error === null ? null : (
                <p
                  role="alert"
                  data-attempt={action.attempt}
                  className="text-sm text-destructive-foreground"
                >
                  {action.error}
                </p>
              )}
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="icon"
              aria-label="Start shell"
              disabled={selected === null || action.pending}
            >
              <ArrowUpIcon />
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
