import {
  filterFilesystemBrowseEntries,
  getFilesystemBrowsePath,
} from "@t3tools/client-runtime/state/filesystem";
import { type EnvironmentId, folderNameProblem, type WorkspaceDetail } from "@t3tools/contracts";
import { ArrowUpIcon, FolderIcon, FolderPlusIcon } from "lucide-react";
import { useRef, useState } from "react";

import { filesystemEnvironment, useFilesystemReadAccess } from "../../state/filesystem";
import { useEnvironmentQuery } from "../../state/query";
import type { AddFolderRequest } from "../../state/workspaces";
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
import { Input } from "../ui/input";
import { Radio, RadioGroup } from "../ui/radio-group";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";

type AddMode = "import" | "create";

/**
 * Picks a workspace folder (or adds one) and starts an agent shell in it. The dialog stays open
 * with the server's reason when a folder cannot be added or a shell cannot start.
 */
export function StartShellDialog({
  open,
  initialAdding,
  onOpenChange,
  environmentId,
  workspace,
  canAddFolder,
  onAddFolder,
  onStart,
}: {
  readonly open: boolean;
  /** Opens straight on "Add folder", as the sidebar's add-project icon does. */
  readonly initialAdding: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: EnvironmentId | null;
  readonly workspace: WorkspaceDetail;
  readonly canAddFolder: boolean;
  readonly onAddFolder: (
    request: AddFolderRequest,
  ) => Promise<{ readonly folder: string } | { readonly error: string }>;
  readonly onStart: (folder: string) => Promise<string | null>;
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  const [adding, setAdding] = useState<AddMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Tells one refusal from the next when both read the same.
  const [attempt, setAttempt] = useState(0);
  // A second click lands before React re-renders with the button disabled (EC-7).
  const busy = useRef(false);

  const folderPaths = workspace.folders.map((folder) => folder.path);
  // The remembered folder is offered only while it is still in this workspace (AC-14, AC-25).
  const selected =
    chosen !== null && folderPaths.includes(chosen)
      ? chosen
      : workspace.lastFolder !== null && folderPaths.includes(workspace.lastFolder)
        ? workspace.lastFolder
        : null;
  const addMode = adding ?? (initialAdding && canAddFolder ? "import" : null);

  const reset = () => {
    setChosen(null);
    setAdding(null);
    setError(null);
  };

  const close = (next: boolean) => {
    if (busy.current) return;
    if (!next) reset();
    onOpenChange(next);
  };

  const guarded = async (work: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    setAttempt((count) => count + 1);
    const settle = () => {
      busy.current = false;
      setPending(false);
    };
    await work().then(settle, (error: unknown) => {
      settle();
      throw error;
    });
  };

  const start = () =>
    guarded(async () => {
      if (selected === null) return;
      const failure = await onStart(selected);
      if (failure !== null) {
        setError(failure);
        return;
      }
      reset();
      onOpenChange(false);
    });

  const add = (request: AddFolderRequest) =>
    guarded(async () => {
      const result = await onAddFolder(request);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setError(null);
      setAdding(null);
      setChosen(result.folder);
    });

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
            <div className="grid gap-3">
              {workspace.folders.length === 0 ? (
                <p className="text-sm text-muted-foreground">This workspace has no folders yet.</p>
              ) : (
                <RadioGroup
                  aria-label="Folders"
                  value={selected ?? ""}
                  onValueChange={(value) => {
                    setChosen(String(value));
                    setError(null);
                  }}
                >
                  {workspace.folders.map((folder) => (
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
              {canAddFolder ? (
                addMode === null ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="justify-self-start"
                    onClick={() => {
                      setAdding("import");
                      setError(null);
                    }}
                  >
                    <FolderPlusIcon />
                    Add folder
                  </Button>
                ) : (
                  <AddFolderPanel
                    mode={addMode}
                    onModeChange={(mode) => {
                      setAdding(mode);
                      setError(null);
                    }}
                    environmentId={environmentId}
                    pending={pending}
                    onAdd={(request) => void add(request)}
                    onCancel={() => {
                      setAdding(null);
                      setError(null);
                    }}
                  />
                )
              ) : null}
              {error === null ? null : (
                <p
                  role="alert"
                  data-attempt={attempt}
                  className="text-sm text-destructive-foreground"
                >
                  {error}
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
              disabled={selected === null || pending}
            >
              <ArrowUpIcon />
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

function AddFolderPanel({
  mode,
  onModeChange,
  environmentId,
  pending,
  onAdd,
  onCancel,
}: {
  readonly mode: AddMode;
  readonly onModeChange: (mode: AddMode) => void;
  readonly environmentId: EnvironmentId | null;
  readonly pending: boolean;
  readonly onAdd: (request: AddFolderRequest) => void;
  readonly onCancel: () => void;
}) {
  const [path, setPath] = useState("");
  const [folderName, setFolderName] = useState("");
  const nameProblem = folderName.trim().length === 0 ? null : folderNameProblem(folderName);
  const ready =
    path.trim().length > 0 &&
    (mode === "import" || (folderName.trim().length > 0 && nameProblem === null));

  return (
    <div className="grid gap-2 rounded-lg border border-border p-3" data-testid="add-folder">
      <ToggleGroup
        aria-label="How to add a folder"
        value={[mode]}
        onValueChange={(value) => {
          const next = value[0];
          if (next === "import" || next === "create") onModeChange(next);
        }}
      >
        <ToggleGroupItem value="import">Import existing folder</ToggleGroupItem>
        <ToggleGroupItem value="create">Create new folder</ToggleGroupItem>
      </ToggleGroup>
      <FolderPathField
        label={mode === "import" ? "Folder" : "Create it in"}
        value={path}
        onChange={setPath}
        environmentId={environmentId}
      />
      {mode === "create" ? (
        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-foreground">New folder name</span>
          <Input
            aria-invalid={nameProblem !== null}
            value={folderName}
            onChange={(event) => setFolderName(event.target.value)}
          />
          {nameProblem === null ? null : (
            <span className="text-xs text-destructive-foreground">{nameProblem}</span>
          )}
        </label>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!ready || pending}
          onClick={() =>
            onAdd(
              mode === "import"
                ? { mode, path: path.trim() }
                : { mode, parentPath: path.trim(), folderName: folderName.trim() },
            )
          }
        >
          {mode === "import" ? "Add folder" : "Create folder"}
        </Button>
      </div>
    </div>
  );
}

/** A path field that lists the folders under what has been typed, for picking with a pointer. */
function FolderPathField({
  label,
  value,
  onChange,
  environmentId,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly environmentId: EnvironmentId | null;
}) {
  const access = useFilesystemReadAccess(environmentId);
  const browse = getFilesystemBrowsePath(value, "", access.canReadFiles);
  const query = useEnvironmentQuery(
    environmentId === null || !browse.isBrowsing || browse.directoryPath.length === 0
      ? null
      : filesystemEnvironment.browse({
          environmentId,
          input: { partialPath: browse.directoryPath },
        }),
  );
  const { visibleEntries } = filterFilesystemBrowseEntries(
    query.data?.entries ?? [],
    browse.filterQuery,
  );
  const suggestions = visibleEntries.slice(0, 8);

  return (
    <div className="grid gap-1.5">
      <label className="grid gap-1.5">
        <span className="text-xs font-medium text-foreground">{label}</span>
        <Input
          placeholder="/path/to/folder"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          spellCheck={false}
        />
      </label>
      {suggestions.length === 0 ? null : (
        <ul aria-label="Folder suggestions" className="grid max-h-40 overflow-y-auto">
          {suggestions.map((entry) => (
            <li key={entry.fullPath}>
              <Button
                type="button"
                variant="ghost"
                size="compact"
                className="w-full justify-start"
                onClick={() => onChange(`${entry.fullPath}/`)}
              >
                <FolderIcon />
                {entry.name}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
