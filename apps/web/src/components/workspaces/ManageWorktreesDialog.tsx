import type { WorkspaceFolder } from "@t3tools/contracts";
import { useState } from "react";

import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { folderName } from "./shellName";
import { worktreeLabel } from "./worktreeChoice";

/**
 * Chooses which of a repository's worktrees the tree shows. Hiding one also hides its shells,
 * which keep running; nothing on disk changes.
 */
export function ManageWorktreesDialog({
  folder,
  onOpenChange,
  onToggle,
}: {
  /** The repository whose worktrees are managed; null keeps the dialog closed. */
  readonly folder: WorkspaceFolder | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onToggle: (worktree: string, visible: boolean) => Promise<string | null>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const worktrees = folder?.worktrees ?? [];

  const toggle = async (worktree: string, visible: boolean) => {
    if (pending !== null) return;
    setPending(worktree);
    setError(await onToggle(worktree, visible));
    setPending(null);
  };

  return (
    <Dialog
      open={folder !== null}
      onOpenChange={(open) => {
        if (!open) setError(null);
        onOpenChange(open);
      }}
    >
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Manage worktrees</DialogTitle>
          <DialogDescription>
            {folder === null
              ? null
              : `Choose which worktrees of ${folderName(folder.path)} the sidebar shows. Hidden worktrees and their shells stay on disk and keep running.`}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-1">
            {worktrees.map((worktree) => {
              const label = worktreeLabel(worktree);
              return (
                <label
                  key={worktree.path}
                  className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/50"
                >
                  <Checkbox
                    checked={worktree.visible}
                    disabled={pending !== null}
                    aria-label={label}
                    onCheckedChange={(checked) => void toggle(worktree.path, checked === true)}
                  />
                  <span className="shrink-0 text-sm">{label}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                    {worktree.path}
                  </span>
                </label>
              );
            })}
            {error === null ? null : (
              <p role="alert" className="text-sm text-destructive-foreground">
                {error}
              </p>
            )}
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
