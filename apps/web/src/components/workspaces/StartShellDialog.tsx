import {
  filterFilesystemBrowseEntries,
  getFilesystemBrowsePath,
} from "@t3tools/client-runtime/state/filesystem";
import { type EnvironmentId, folderNameProblem, type WorkspaceDetail } from "@t3tools/contracts";
import {
  ArrowUpIcon,
  CornerLeftUpIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
} from "lucide-react";
import { useRef, useState } from "react";

import { isElectron } from "../../env";
import { readLocalApi } from "../../localApi";
import { filesystemEnvironment, useFilesystemReadAccess } from "../../state/filesystem";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironments } from "../../state/environments";
import { readPreparedConnection } from "../../state/session";
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
import {
  Autocomplete,
  AutocompleteEmpty,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompletePopup,
} from "../ui/autocomplete";
import { Input } from "../ui/input";
import { Radio, RadioGroup } from "../ui/radio-group";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { isServerRemote } from "./serverLocation";

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
  // Closing the add panel must stick even when the dialog was opened straight on it.
  const [addDismissed, setAddDismissed] = useState(false);
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
  const addMode = adding ?? (initialAdding && canAddFolder && !addDismissed ? "import" : null);

  const reset = () => {
    setChosen(null);
    setAdding(null);
    setAddDismissed(false);
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
      setAddDismissed(true);
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
                      setAddDismissed(true);
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
  // Starts in the server's home folder, so the folder list shows before anything is typed.
  const [path, setPath] = useState("~/");
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

/** The folder above `path`, with a trailing separator; the root stays the root. */
const parentFolder = (path: string) => {
  const trimmed = path.replace(/[\\/]+$/, "");
  const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return cut <= 0 ? "/" : `${trimmed.slice(0, cut)}/`;
};

/**
 * A path field over a browser of the server's folders. The browser lists the folder the field
 * points at (the home folder when empty) while the field has focus, so a folder can be picked
 * with the pointer alone.
 */
interface FolderItem {
  readonly path: string;
  readonly name: string;
  readonly up: boolean;
}

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
  const empty = value.trim().length === 0;
  const directory = !access.canReadFiles
    ? null
    : empty
      ? "~/"
      : browse.isBrowsing && browse.directoryPath.length > 0
        ? browse.directoryPath
        : null;
  const query = useEnvironmentQuery(
    environmentId === null || directory === null
      ? null
      : filesystemEnvironment.browse({ environmentId, input: { partialPath: directory } }),
  );
  // Each folder is a new query; showing the last listing until the next arrives avoids a
  // flash of an empty list.
  const [lastListing, setLastListing] = useState(query.data);
  if (query.data && query.data !== lastListing) setLastListing(query.data);
  const listing = query.data ?? lastListing;
  const listed = listing?.parentPath ?? null;
  const { visibleEntries } = filterFilesystemBrowseEntries(
    listing?.entries ?? [],
    empty ? "" : browse.filterQuery,
  );
  // The native dialog lists this machine's folders, which are the server's only for the
  // desktop app's own server; a browser never learns a picked folder's real path.
  const nativePicker =
    isElectron &&
    environmentId !== null &&
    readPreparedConnection(environmentId)?.target._tag === "PrimaryConnectionTarget";

  const { environments } = useEnvironments();
  const serverOs =
    environments.find((environment) => environment.environmentId === environmentId)?.serverConfig
      ?.environment.platform.os ?? null;
  const remote = isServerRemote({
    desktopOwnServer: nativePicker,
    serverOs,
    clientPlatform: navigator.platform,
    pageHost: window.location.hostname,
  });
  const [listOpen, setListOpen] = useState(false);
  // ".." first, then the listed folder's subfolders; each item's value is the path it selects.
  const items: ReadonlyArray<FolderItem> = [
    ...(listed !== null && listed !== "/"
      ? [{ path: parentFolder(listed), name: "..", up: true }]
      : []),
    ...visibleEntries.map((entry) => ({ path: `${entry.fullPath}/`, name: entry.name, up: false })),
  ];

  const pickNatively = async () => {
    const picked = await readLocalApi()?.dialogs.pickFolder(
      empty ? undefined : { initialPath: value.trim() },
    );
    if (picked) onChange(picked);
  };

  return (
    <div className="grid gap-1.5">
      <label className="grid gap-1.5">
        <span className="text-xs font-medium text-foreground">
          {label}
          {remote ? " (remote server)" : ""}
        </span>
        <Autocomplete
          items={items}
          itemToStringValue={(item) => item.path}
          mode="none"
          openOnInputClick
          open={listOpen && directory !== null}
          onOpenChange={(open, details) => {
            // Picking a folder walks into it, so the list stays open for the next pick.
            if (!open && details.reason === "item-press") return;
            setListOpen(open);
          }}
          value={value}
          onValueChange={(next) => onChange(next)}
        >
          <AutocompleteInput placeholder="/path/to/folder" spellCheck={false} />
          <AutocompletePopup>
            {query.error !== null ? (
              <div className="px-3 py-2 text-xs text-destructive-foreground">{query.error}</div>
            ) : items.length > 0 ? (
              <AutocompleteList aria-label="Folders on the server" className="max-h-72">
                {items.map((item) => (
                  <AutocompleteItem key={item.path} value={item}>
                    {item.up ? <CornerLeftUpIcon /> : <FolderIcon />}
                    <span className="min-w-0 truncate">{item.name}</span>
                  </AutocompleteItem>
                ))}
              </AutocompleteList>
            ) : listing !== null && !query.isPending ? (
              <AutocompleteEmpty>No folders here</AutocompleteEmpty>
            ) : null}
          </AutocompletePopup>
        </Autocomplete>
      </label>
      {nativePicker ? (
        <Button
          type="button"
          variant="outline"
          size="compact"
          className="justify-self-start"
          onClick={() => void pickNatively()}
        >
          <FolderOpenIcon />
          Choose in Finder…
        </Button>
      ) : null}
    </div>
  );
}
