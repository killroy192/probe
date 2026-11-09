import {
  type StartingScript,
  type StartingScriptChoice,
  startingScriptLabel,
  type WorkspaceDetail,
  WorkspaceProject,
  WorkspaceProjectGit,
  WorkspaceWorktreeChoice,
} from "@t3tools/contracts";
import { ArrowUpIcon, FolderIcon, GitBranchIcon } from "lucide-react";
import { type ReactNode, useEffect, useEffectEvent, useState } from "react";

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
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { useDialogAction } from "./dialogAction";
import { folderName } from "./shellName";
import {
  existingWorktrees,
  PLAIN_SHELL,
  preselectedScript,
  resolvePlace,
  startingPoints,
  toChoice,
  type WorktreeMode,
  type WorktreeOption,
} from "./worktreeChoice";

type GitResult = { readonly git: WorkspaceProjectGit } | { readonly error: string };

/**
 * Creates a shell in one project: in an existing worktree, or in a new one forked from a worktree
 * or a branch. A project that is not a git repository only starts a shell in its folder. The
 * dialog stays open with the server's reason when the shell cannot start.
 */
export function StartShellDialog({
  project,
  onOpenChange,
  workspace,
  loadGit,
  loadScripts,
  onStart,
}: {
  /** The project the shell is created in; null keeps the dialog closed. */
  readonly project: WorkspaceProject | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly workspace: WorkspaceDetail;
  readonly loadGit: (project: string) => Promise<GitResult>;
  readonly loadScripts: () => Promise<ReadonlyArray<StartingScript>>;
  readonly onStart: (
    project: string,
    worktree: WorkspaceWorktreeChoice | null,
    script: StartingScriptChoice | null,
  ) => Promise<string | null>;
}) {
  const [chosenMode, setChosenMode] = useState<WorktreeMode | null>(null);
  const [chosenWorktree, setChosenWorktree] = useState<string | null>(null);
  const [chosenStartingPoint, setChosenStartingPoint] = useState<string | null>(null);
  const [chosenScript, setChosenScript] = useState<string | null>(null);
  const [scripts, setScripts] = useState<ReadonlyArray<StartingScript> | null>(null);
  const [loaded, setLoaded] = useState<{
    readonly project: string;
    readonly result: GitResult;
  } | null>(null);
  const action = useDialogAction();

  const path = project?.path ?? null;
  const isGit = project?.isGitRepository === true;

  const readGit = useEffectEvent((target: string) => loadGit(target));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the project's worktrees from the server each time the dialog shows it
  useEffect(() => {
    if (path === null || !isGit) return;
    let current = true;
    void readGit(path).then((result) => {
      if (current) setLoaded({ project: path, result });
    });
    return () => {
      current = false;
    };
  }, [path, isGit]);

  const readScripts = useEffectEvent(() => loadScripts());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the user's starting scripts from the server each time the dialog opens
  useEffect(() => {
    if (path === null) return;
    let current = true;
    void readScripts().then((next) => {
      if (current) setScripts(next);
    });
    return () => {
      current = false;
    };
  }, [path]);

  const lastStart = path === null ? null : (workspace.lastStarts[path] ?? null);
  const script =
    scripts === null
      ? PLAIN_SHELL
      : chosenScript !== null && scripts.some((entry) => entry.id === chosenScript)
        ? chosenScript
        : chosenScript === PLAIN_SHELL
          ? PLAIN_SHELL
          : preselectedScript(lastStart, scripts);
  const result = isGit && loaded?.project === path ? loaded.result : null;
  const git = result !== null && "git" in result ? result.git : null;
  const place =
    git === null || path === null
      ? null
      : resolvePlace({
          project: path,
          git,
          lastStart,
          chosenMode,
          chosenWorktree,
          chosenStartingPoint,
        });
  const choice = git === null || place === null ? null : toChoice(git, place);
  const isNew = place?.mode === "new";
  // Starting before the list arrives would start a plain shell instead of the preselected script.
  const canStart =
    path !== null &&
    scripts !== null &&
    !action.pending &&
    (!isGit ||
      (result !== null &&
        (git === null || (choice !== null && !(isNew && git.branchesError !== null)))));

  const reset = () => {
    setChosenMode(null);
    setChosenWorktree(null);
    setChosenStartingPoint(null);
    setChosenScript(null);
    setLoaded(null);
    setScripts(null);
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
    if (path === null || !canStart) return;
    const worktree = isGit ? (choice ?? { kind: "checkout" as const }) : null;
    const picked = scripts?.find((entry) => entry.id === script);
    const chosen = picked === undefined ? null : { id: picked.id, name: startingScriptLabel(picked) };
    if (await action.run(() => onStart(path, worktree, chosen))) {
      reset();
      onOpenChange(false);
    } else if (isGit) {
      // A worktree kept or removed by the failed start shows up on retry.
      void loadGit(path).then((next) => setLoaded({ project: path, result: next }));
    }
  };

  return (
    <Dialog open={project !== null} onOpenChange={close}>
      <DialogPopup className="max-w-lg">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void start();
          }}
        >
          <DialogHeader>
            <DialogTitle>Create shell</DialogTitle>
            <DialogDescription>
              {path === null ? null : `In ${folderName(path)}. The starting script runs in it.`}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            {/* A single shrinkable column, so a long path truncates instead of scrolling. */}
            <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
              <Field label="Starting script">
                <ScriptSelect
                  value={script}
                  scripts={scripts ?? []}
                  onChange={(key) => {
                    setChosenScript(key);
                    action.clearError();
                  }}
                />
              </Field>
              {!isGit ? null : result === null ? (
                <p className="text-sm text-muted-foreground">Reading worktrees…</p>
              ) : "error" in result ? (
                <p className="text-sm text-destructive-foreground">{result.error}</p>
              ) : place === null ? null : (
                <>
                  <ToggleGroup
                    aria-label="Worktree"
                    className="w-full *:flex-1"
                    value={[place.mode]}
                    onValueChange={(next) => {
                      const value = next[0];
                      if (value === "new" || value === "existing") setChosenMode(value);
                      action.clearError();
                    }}
                  >
                    <Toggle value="existing">Existing</Toggle>
                    <Toggle value="new" disabled={!result.git.hasCommit}>
                      Fork
                    </Toggle>
                  </ToggleGroup>
                  {result.git.hasCommit ? null : (
                    <p className="text-sm text-muted-foreground">
                      This repository has no commit yet, so it cannot have another worktree.
                    </p>
                  )}
                  {place.mode === "existing" ? (
                    <Field label="Start in">
                      {result.git.worktreesError === null ? (
                        <WorktreeSelect
                          label="Start in"
                          value={place.worktree}
                          options={existingWorktrees(result.git)}
                          onChange={(key) => {
                            setChosenWorktree(key);
                            action.clearError();
                          }}
                        />
                      ) : (
                        <p className="text-sm text-destructive-foreground">
                          The worktrees could not be listed: {result.git.worktreesError}. The shell
                          starts in the project's folder.
                        </p>
                      )}
                    </Field>
                  ) : (
                    <Field label="Fork from">
                      {result.git.branchesError === null ? (
                        <WorktreeSelect
                          label="Fork from"
                          value={place.startingPoint}
                          options={startingPoints(result.git)}
                          onChange={(key) => {
                            setChosenStartingPoint(key);
                            action.clearError();
                          }}
                        />
                      ) : (
                        <p className="text-sm text-destructive-foreground">
                          The starting points could not be listed: {result.git.branchesError}
                        </p>
                      )}
                      <p className="truncate text-sm">
                        <span className="text-muted-foreground">New worktree and branch: </span>
                        <span className="font-mono text-xs">{result.git.proposedWorktreeName}</span>
                      </p>
                    </Field>
                  )}
                </>
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
            <Button type="submit" size="icon" aria-label="Create shell" disabled={!canStart}>
              <ArrowUpIcon />
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

function Field({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

/** Plain shell first, then the user's scripts, told apart by id since names may repeat. */
function ScriptSelect({
  value,
  scripts,
  onChange,
}: {
  readonly value: string;
  readonly scripts: ReadonlyArray<StartingScript>;
  readonly onChange: (key: string) => void;
}) {
  const options = [
    { key: PLAIN_SHELL, label: "Plain shell" },
    ...scripts.map((script) => ({ key: script.id, label: startingScriptLabel(script) })),
  ];
  return (
    <Select
      value={value}
      onValueChange={(key) => {
        if (key !== null) onChange(key);
      }}
    >
      <SelectTrigger size="sm" aria-label="Starting script">
        <SelectValue>
          {(key: string | null) => {
            const option = options.find((candidate) => candidate.key === key) ?? options[0]!;
            return (
              <span data-key={option.key} className="truncate">
                {option.label}
              </span>
            );
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectPopup alignItemWithTrigger={false}>
        {options.map((option) => (
          <SelectItem
            key={option.key}
            value={option.key}
            data-key={option.key}
            data-title={option.label}
          >
            <span className="truncate">{option.label}</span>
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

function WorktreeSelect({
  label,
  value,
  options,
  onChange,
}: {
  readonly label: string;
  readonly value: string | null;
  readonly options: ReadonlyArray<WorktreeOption>;
  readonly onChange: (key: string) => void;
}) {
  return (
    <Select
      value={value}
      onValueChange={(key) => {
        if (key !== null) onChange(key);
      }}
    >
      <SelectTrigger size="sm" aria-label={label}>
        <SelectValue>
          {(key: string | null) => {
            const option = options.find((candidate) => candidate.key === key);
            return option === undefined ? (
              "Pick a worktree"
            ) : (
              <span data-key={option.key} className="flex min-w-0 items-center gap-1.5">
                <OptionIcon kind={option.kind} />
                <span className="truncate">{option.title}</span>
                {option.worktree === null ? null : (
                  <span className="truncate text-muted-foreground">{option.worktree}</span>
                )}
              </span>
            );
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectPopup alignItemWithTrigger={false}>
        {options.map((option) => (
          <SelectItem
            key={option.key}
            value={option.key}
            data-key={option.key}
            data-kind={option.kind}
            data-title={option.title}
            data-worktree={option.worktree ?? ""}
          >
            <span className="flex min-w-0 items-start gap-2">
              <OptionIcon kind={option.kind} />
              <span className="grid min-w-0">
                <span className="truncate">{option.title}</span>
                {option.worktree === null ? null : (
                  <span className="truncate text-xs text-muted-foreground">{option.worktree}</span>
                )}
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

function OptionIcon({ kind }: { readonly kind: WorktreeOption["kind"] }) {
  const Icon = kind === "worktree" ? FolderIcon : GitBranchIcon;
  return <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />;
}
