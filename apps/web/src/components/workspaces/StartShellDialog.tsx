import type {
  WorkspaceDetail,
  WorkspaceFolderGit,
  WorkspaceWorktreeChoice,
} from "@t3tools/contracts";
import { ArrowUpIcon, FolderIcon, GitBranchIcon, GitForkIcon } from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";

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
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { useDialogAction } from "./dialogAction";
import { folderName } from "./shellName";
import {
  PRIMARY,
  resolveSelection,
  startingPoints,
  toChoice,
  worktreeLabel,
  type WorktreeSelection,
} from "./worktreeChoice";

type GitResult = { readonly git: WorkspaceFolderGit } | { readonly error: string };

const NEW = "new";
const CHECKOUT = "checkout";
const EXISTING = "existing:";

const selectionValue = (selection: WorktreeSelection) =>
  selection.kind === "existing" ? `${EXISTING}${selection.path}` : selection.kind;

const selectionFromValue = (value: string): WorktreeSelection =>
  value === NEW
    ? { kind: "new" }
    : value.startsWith(EXISTING)
      ? { kind: "existing", path: value.slice(EXISTING.length) }
      : { kind: "checkout" };

/**
 * Picks one of the workspace's folders and, in a git folder, its primary worktree, a linked one
 * or a new one, then starts an agent shell there. With `newWorktreeIn` it only creates a new
 * worktree of that folder. Folders gone from disk are not offered. The dialog stays open with the
 * server's reason when the shell cannot start.
 */
export function StartShellDialog({
  open,
  onOpenChange,
  workspace,
  newWorktreeIn = null,
  loadGit,
  onStart,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly workspace: WorkspaceDetail;
  readonly newWorktreeIn?: string | null;
  readonly loadGit: (folder: string) => Promise<GitResult>;
  readonly onStart: (
    folder: string,
    worktree: WorkspaceWorktreeChoice | null,
  ) => Promise<string | null>;
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  const [chosenWorktree, setChosenWorktree] = useState<WorktreeSelection | null>(null);
  const [chosenStartingPoint, setChosenStartingPoint] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{
    readonly folder: string;
    readonly result: GitResult;
  } | null>(null);
  const action = useDialogAction();

  const folders = workspace.folders.filter((folder) => folder.exists);
  const folderPaths = folders.map((folder) => folder.path);
  const lastFolder = workspace.lastStart?.folder ?? null;
  // The remembered folder is offered only while it is still in this workspace (AC-14, AC-25).
  const selected =
    newWorktreeIn !== null
      ? folderPaths.includes(newWorktreeIn)
        ? newWorktreeIn
        : null
      : chosen !== null && folderPaths.includes(chosen)
        ? chosen
        : lastFolder !== null && folderPaths.includes(lastFolder)
          ? lastFolder
          : null;
  const isGit = folders.some((folder) => folder.path === selected && folder.isGitRepository);

  const readGit = useEffectEvent((folder: string) => loadGit(folder));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the folder's worktrees from the server each time the dialog shows it
  useEffect(() => {
    if (!open || selected === null || !isGit) return;
    let current = true;
    void readGit(selected).then((result) => {
      if (current) setLoaded({ folder: selected, result });
    });
    return () => {
      current = false;
    };
  }, [open, selected, isGit]);

  const result = isGit && loaded?.folder === selected ? loaded.result : null;
  const git = result !== null && "git" in result ? result.git : null;
  const selection =
    git === null || selected === null
      ? null
      : resolveSelection({
          folder: selected,
          git,
          lastStart: workspace.lastStart,
          chosenWorktree: newWorktreeIn === null ? chosenWorktree : { kind: "new" },
          chosenStartingPoint,
        });
  const choice = git === null || selection === null ? null : toChoice(git, selection);
  const isNew = selection?.worktree.kind === "new";
  const canStart =
    selected !== null &&
    !action.pending &&
    (newWorktreeIn === null || isNew) &&
    (!isGit ||
      (result !== null &&
        (git === null || (choice !== null && !(isNew && git.branchesError !== null)))));

  const reset = () => {
    setChosen(null);
    setChosenWorktree(null);
    setChosenStartingPoint(null);
    setLoaded(null);
  };

  const close = (next: boolean) => {
    if (!action.canClose()) return;
    if (!next) {
      reset();
      action.clearError();
    }
    onOpenChange(next);
  };

  const start = async () => {
    if (selected === null || !canStart) return;
    if (await action.run(() => onStart(selected, isGit ? choice : null))) {
      reset();
      onOpenChange(false);
    } else if (isGit) {
      // A worktree kept or removed by the failed start shows up on retry.
      const folder = selected;
      void loadGit(folder).then((next) => setLoaded({ folder, result: next }));
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
            <DialogTitle>{newWorktreeIn === null ? "Start shell" : "New worktree"}</DialogTitle>
            <DialogDescription>
              {newWorktreeIn === null
                ? `Pick a folder in ${workspace.name}. The agent starts in a new shell there.`
                : `Create a worktree of ${folderName(newWorktreeIn)}. The agent starts in a new shell there.`}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            {/* A single shrinkable column, so a long folder path truncates instead of scrolling. */}
            <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
              {newWorktreeIn !== null ? null : folders.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  This workspace has no folders yet. Add one with Add project in the sidebar.
                </p>
              ) : (
                <RadioGroup
                  aria-label="Folders"
                  value={selected ?? ""}
                  onValueChange={(value) => {
                    setChosen(String(value));
                    setChosenWorktree(null);
                    setChosenStartingPoint(null);
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
              {!isGit ? null : result === null ? (
                <p className="text-sm text-muted-foreground">Reading worktrees…</p>
              ) : "error" in result ? (
                <p className="text-sm text-destructive-foreground">{result.error}</p>
              ) : selection === null ? null : (
                <WorktreeStep
                  git={result.git}
                  onlyNew={newWorktreeIn !== null}
                  selection={selection.worktree}
                  startingPoint={selection.startingPoint}
                  onSelect={(next) => {
                    setChosenWorktree(next);
                    action.clearError();
                  }}
                  onStartingPoint={(key) => {
                    setChosenStartingPoint(key);
                    action.clearError();
                  }}
                />
              )}
              {action.pending && isNew && git !== null ? (
                <p className="text-sm text-muted-foreground">
                  Creating {git.proposedWorktreeName}…
                </p>
              ) : null}
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
            <Button type="submit" size="icon" aria-label="Start shell" disabled={!canStart}>
              <ArrowUpIcon />
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

function WorktreeStep({
  git,
  onlyNew,
  selection,
  startingPoint,
  onSelect,
  onStartingPoint,
}: {
  readonly git: WorkspaceFolderGit;
  readonly onlyNew: boolean;
  readonly selection: WorktreeSelection;
  readonly startingPoint: string | null;
  readonly onSelect: (selection: WorktreeSelection) => void;
  readonly onStartingPoint: (key: string) => void;
}) {
  const primary = git.worktrees.find((worktree) => worktree.isMain);
  const points = startingPoints(git);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
      {onlyNew ? null : (
        <RadioGroup
          aria-label="Worktree"
          value={selectionValue(selection)}
          onValueChange={(value) => onSelect(selectionFromValue(String(value)))}
        >
          <WorktreeOption
            value={CHECKOUT}
            label={
              primary !== undefined
                ? worktreeLabel(primary)
                : git.currentBranch === null
                  ? PRIMARY
                  : `${PRIMARY} · ${git.currentBranch}`
            }
          />
          {git.worktrees
            .filter((worktree) => !worktree.isMain)
            .map((worktree) => (
              <WorktreeOption
                key={worktree.path}
                value={`${EXISTING}${worktree.path}`}
                label={worktreeLabel(worktree)}
                detail={worktree.path}
              />
            ))}
          {git.hasCommit ? <WorktreeOption value={NEW} label="New worktree" icon="new" /> : null}
        </RadioGroup>
      )}
      {onlyNew && !git.hasCommit ? (
        <p className="text-sm text-muted-foreground">
          This repository has no commit yet, so it cannot have another worktree.
        </p>
      ) : null}
      {git.worktreesError === null ? null : (
        <p className="text-sm text-destructive-foreground">
          The worktrees could not be listed: {git.worktreesError}
        </p>
      )}
      {selection.kind !== "new" ? null : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-2 rounded-md border p-2">
          <p className="truncate text-sm">
            <span className="text-muted-foreground">New worktree and branch: </span>
            <span className="font-mono text-xs">{git.proposedWorktreeName}</span>
          </p>
          {git.branchesError === null ? (
            <Select
              value={startingPoint}
              onValueChange={(key) => {
                if (key !== null) onStartingPoint(key);
              }}
            >
              <SelectTrigger size="sm" aria-label="Starting point">
                <SelectValue>
                  {(key: string | null) =>
                    points.find((point) => point.key === key)?.label ?? "Pick a starting point"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectPopup alignItemWithTrigger={false}>
                {points.map((point) => (
                  <SelectItem key={point.key} value={point.key}>
                    {point.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          ) : (
            <p className="text-sm text-destructive-foreground">
              The starting points could not be listed: {git.branchesError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function WorktreeOption({
  value,
  label,
  detail,
  icon,
}: {
  readonly value: string;
  readonly label: string;
  readonly detail?: string;
  readonly icon?: "new";
}) {
  const Icon = icon === "new" ? GitForkIcon : GitBranchIcon;
  return (
    <label className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/50">
      <Radio value={value} aria-label={label} />
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="shrink-0 text-sm">{label}</span>
      {detail === undefined ? null : (
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
          {detail}
        </span>
      )}
    </label>
  );
}
