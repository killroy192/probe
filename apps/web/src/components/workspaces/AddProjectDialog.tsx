import {
  filterFilesystemBrowseEntries,
  getFilesystemBrowsePath,
} from "@t3tools/client-runtime/state/filesystem";
import { type EnvironmentId, folderNameProblem } from "@t3tools/contracts";
import { CornerLeftUpIcon, FolderIcon, FolderOpenIcon } from "lucide-react";
import { useState } from "react";

import { isElectron } from "../../env";
import { readLocalApi } from "../../localApi";
import { useEnvironments } from "../../state/environments";
import { filesystemEnvironment, useFilesystemReadAccess } from "../../state/filesystem";
import { useEnvironmentQuery } from "../../state/query";
import { readPreparedConnection } from "../../state/session";
import type { AddProjectRequest } from "../../state/workspaces";
import {
  Autocomplete,
  AutocompleteEmpty,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompletePopup,
} from "../ui/autocomplete";
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
import { toastManager } from "../ui/toast";
import { Input } from "../ui/input";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { useDialogAction } from "./dialogAction";
import { isServerRemote } from "./serverLocation";

type AddMode = "import" | "create";

/**
 * Adds a project to the workspace: imports an existing folder or creates a new one with git. It
 * starts no shell. The dialog stays open with the server's reason when the folder is refused.
 */
export function AddProjectDialog({
  open,
  onOpenChange,
  environmentId,
  workspaceName,
  onAddProject,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: EnvironmentId | null;
  readonly workspaceName: string;
  readonly onAddProject: (
    request: AddProjectRequest,
  ) => Promise<
    { readonly project: string; readonly resolvedFrom: string | null } | { readonly error: string }
  >;
}) {
  const [mode, setMode] = useState<AddMode>("import");
  // Starts in the server's home folder, so the folder list shows before anything is typed.
  const [path, setPath] = useState("~/");
  const [folderName, setFolderName] = useState("");
  const action = useDialogAction();
  const nameProblem = folderName.trim().length === 0 ? null : folderNameProblem(folderName);
  const ready =
    path.trim().length > 0 &&
    (mode === "import" || (folderName.trim().length > 0 && nameProblem === null));

  const reset = () => {
    setMode("import");
    setPath("~/");
    setFolderName("");
    action.clearError();
  };

  const close = (next: boolean) => {
    if (!action.canClose()) return;
    if (!next) reset();
    onOpenChange(next);
  };

  const submit = async () => {
    if (!ready) return;
    const request: AddProjectRequest =
      mode === "import"
        ? { mode, path: path.trim() }
        : { mode, parentPath: path.trim(), folderName: folderName.trim() };
    const added = await action.run(async () => {
      const result = await onAddProject(request);
      if ("error" in result) return result.error;
      if (result.resolvedFrom !== null) {
        toastManager.add({
          type: "info",
          title: "Added the project of this worktree",
          description: `${result.resolvedFrom} is a worktree of ${result.project}, so that project was added. Its worktrees are offered when you create a shell.`,
        });
      }
      return null;
    });
    if (added) {
      reset();
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
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Add project to workspace</DialogTitle>
            <DialogDescription>
              Import an existing folder into {workspaceName} as a project, or create a new one with
              git.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="grid gap-3" data-testid="add-project">
              <ToggleGroup
                aria-label="How to add a project"
                value={[mode]}
                onValueChange={(value) => {
                  const next = value[0];
                  if (next === "import" || next === "create") {
                    setMode(next);
                    action.clearError();
                  }
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
            <Button type="submit" disabled={!ready || action.pending}>
              {mode === "import" ? "Add project" : "Create project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
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
