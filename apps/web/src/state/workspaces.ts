import { useAtomSet, useAtomValue } from "@effect/atom-react";
import {
  ConnectionBlockedError,
  ConnectionTransientError,
} from "@t3tools/client-runtime/connection";
import { EnvironmentRpcUnavailableError, isRpcClientError } from "@t3tools/client-runtime/rpc";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import { createWorkspaceEnvironmentAtoms } from "@t3tools/client-runtime/state/workspaces";
import {
  AuthOrchestrationReadScope,
  type EnvironmentId,
  type ShellId,
  type WorkspaceDetail,
  type WorkspaceFolderGit,
  type WorkspaceSummary,
  type WorkspaceWorktreeChoice,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";
import { Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { usePrimaryEnvironmentId } from "./environments";
import { formatEnvironmentQueryError, useEnvironmentQuery } from "./query";
import { useEnvironmentScope } from "./session";
import { useShells } from "./shells";
import { useAtomCommand } from "./use-atom-command";

const workspaceEnvironment = createWorkspaceEnvironmentAtoms(connectionAtomRuntime);

interface ShownWorkspace {
  readonly environmentId: EnvironmentId;
  readonly detail: WorkspaceDetail;
}

/** The shells a workspace shows as tabs, in the order they were started. */
interface WorkspaceTabs {
  readonly shellIds: ReadonlyArray<ShellId>;
  readonly activeShellId: ShellId | null;
}

const NO_TABS: WorkspaceTabs = { shellIds: [], activeShellId: null };

// Kept in memory only: a reload returns to the start screen until story 7 restores it.
const shownWorkspaceAtom = Atom.make<ShownWorkspace | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("web-shown-workspace"),
);

const tabsAtom = Atom.make<Readonly<Record<string, WorkspaceTabs>>>({}).pipe(
  Atom.keepAlive,
  Atom.withLabel("web-workspace-tabs"),
);

const tabsKey = (environmentId: EnvironmentId, name: string) =>
  JSON.stringify([environmentId, name]);

const isConnectionLost = Schema.is(
  Schema.Union([ConnectionTransientError, ConnectionBlockedError, EnvironmentRpcUnavailableError]),
);

const CONNECTION_LOST =
  "The shell did not start: the connection to the server was lost. Try again.";

const startFailure = (cause: Cause.Cause<unknown>) => {
  const error = Cause.squash(cause);
  return isConnectionLost(error) || isRpcClientError(error)
    ? CONNECTION_LOST
    : formatEnvironmentQueryError(cause);
};

/** Null on success, else the reason to show the user. */
type WorkspaceActionResult = Promise<string | null>;

export type AddFolderRequest =
  | { readonly mode: "import"; readonly path: string }
  | { readonly mode: "create"; readonly parentPath: string; readonly folderName: string };

export interface WorkspacesView {
  readonly environmentId: EnvironmentId | null;
  /** Null until the first list arrives. */
  readonly workspaces: ReadonlyArray<WorkspaceSummary> | null;
  readonly listError: string | null;
  /** Whether this client may create and remove workspaces and add folders (settings write). */
  readonly canChange: boolean;
  /** Whether this client may start shells (terminal operate). */
  readonly canStartShell: boolean;
  /** The shown workspace, or null for the start screen. */
  readonly shown: WorkspaceDetail | null;
  readonly tabs: WorkspaceTabs;
  readonly create: (name: string) => WorkspaceActionResult;
  readonly open: (name: string) => WorkspaceActionResult;
  /** Reads the shown workspace again, so a folder deleted on disk is no longer preselected. */
  readonly refresh: () => WorkspaceActionResult;
  readonly remove: (name: string) => WorkspaceActionResult;
  /** The added folder's path, or the reason it was not added. */
  readonly addFolder: (
    request: AddFolderRequest,
  ) => Promise<
    { readonly folder: string; readonly resolvedFrom: string | null } | { readonly error: string }
  >;
  /** Shows or hides one worktree of a folder in the tree; nothing on disk changes. */
  readonly setWorktreeVisible: (
    folder: string,
    worktree: string,
    visible: boolean,
  ) => WorkspaceActionResult;
  /** A git folder's worktrees, branches and a fresh worktree name, read anew on each call. */
  readonly folderGit: (
    folder: string,
  ) => Promise<{ readonly git: WorkspaceFolderGit } | { readonly error: string }>;
  /** Adds and shows a tab only once the server has a running shell. */
  readonly startShell: (
    folder: string,
    worktree: WorkspaceWorktreeChoice | null,
    size: { readonly cols: number; readonly rows: number } | null,
  ) => WorkspaceActionResult;
  readonly activateShell: (shellId: ShellId) => void;
}

/** Saved workspaces of the primary environment and the one this page shows. */
export function useWorkspaces(): WorkspacesView {
  const environmentId = usePrimaryEnvironmentId();
  const canRead = useEnvironmentScope(environmentId, AuthOrchestrationReadScope);
  const query = useEnvironmentQuery(
    environmentId === null || !canRead
      ? null
      : workspaceEnvironment.list({ environmentId, input: null }),
  );
  const { shells } = useShells(environmentId);
  const shownState = useAtomValue(shownWorkspaceAtom);
  const setShown = useAtomSet(shownWorkspaceAtom);
  const allTabs = useAtomValue(tabsAtom);
  const setAllTabs = useAtomSet(tabsAtom);
  const createCommand = useAtomCommand(workspaceEnvironment.create, { reportFailure: false });
  const openCommand = useAtomCommand(workspaceEnvironment.open, { reportFailure: false });
  const removeCommand = useAtomCommand(workspaceEnvironment.remove, { reportFailure: false });
  const addFolderCommand = useAtomCommand(workspaceEnvironment.addFolder, {
    reportFailure: false,
  });
  const visibilityCommand = useAtomCommand(workspaceEnvironment.setWorktreeVisible, {
    reportFailure: false,
  });
  const folderGitCommand = useAtomCommand(workspaceEnvironment.folderGit, {
    reportFailure: false,
  });
  const startShellCommand = useAtomCommand(workspaceEnvironment.startShell, {
    reportFailure: false,
  });
  const canChange = useAtomValue(workspaceEnvironment.create.permissionAtom(environmentId));
  const canStartShell = useAtomValue(workspaceEnvironment.startShell.permissionAtom(environmentId));

  const workspaces = query.data;
  // A workspace removed elsewhere stops being shown as soon as the list drops it.
  const shown =
    shownState !== null &&
    shownState.environmentId === environmentId &&
    workspaces?.some((workspace) => workspace.name === shownState.detail.name)
      ? shownState.detail
      : null;

  const storedTabs =
    shown === null || environmentId === null
      ? NO_TABS
      : (allTabs[tabsKey(environmentId, shown.name)] ?? NO_TABS);
  // A shell closed on the server leaves its tab; closing tabs from the UI is story 6.
  const liveShellIds =
    shells === null
      ? storedTabs.shellIds
      : storedTabs.shellIds.filter((id) => shells.some((shell) => shell.shellId === id));
  const tabs: WorkspaceTabs = {
    shellIds: liveShellIds,
    activeShellId:
      storedTabs.activeShellId !== null && liveShellIds.includes(storedTabs.activeShellId)
        ? storedTabs.activeShellId
        : (liveShellIds.at(-1) ?? null),
  };

  const updateTabs = (
    id: EnvironmentId,
    name: string,
    update: (tabs: WorkspaceTabs) => WorkspaceTabs,
  ) =>
    setAllTabs((all) => {
      const key = tabsKey(id, name);
      return { ...all, [key]: update(all[key] ?? NO_TABS) };
    });

  const run = async <A>(
    action: (environmentId: EnvironmentId) => Promise<AtomCommandResult<A, unknown>>,
    onSuccess: (value: A, environmentId: EnvironmentId) => void,
    describeFailure: (cause: Cause.Cause<unknown>) => string = formatEnvironmentQueryError,
  ): WorkspaceActionResult => {
    if (environmentId === null) return "Not connected to an environment.";
    const result = await action(environmentId);
    if (result._tag === "Failure") return describeFailure(result.cause);
    onSuccess(result.value, environmentId);
    return null;
  };

  const show = (name: string) =>
    run(
      (id) => openCommand({ environmentId: id, input: { name } }),
      (detail, id) => setShown({ environmentId: id, detail }),
    );

  return {
    environmentId,
    workspaces,
    listError: query.error,
    canChange,
    canStartShell,
    shown,
    tabs,
    create: (name) =>
      run(
        (id) => createCommand({ environmentId: id, input: { name } }),
        (created, id) =>
          setShown({
            environmentId: id,
            detail: { name: created.name, folders: [], lastStart: null },
          }),
      ),
    open: (name) => (shown?.name === name ? Promise.resolve(null) : show(name)),
    refresh: () => (shown === null ? Promise.resolve(null) : show(shown.name)),
    remove: (name) =>
      run(
        (id) => removeCommand({ environmentId: id, input: { name } }),
        () => {
          if (shown?.name === name) setShown(null);
        },
      ),
    addFolder: async (request) => {
      if (shown === null) return { error: "Open a workspace first." };
      let folder = "";
      let resolvedFrom: string | null = null;
      const error = await run(
        (id) => addFolderCommand({ environmentId: id, input: { ...request, name: shown.name } }),
        (added, id) => {
          folder = added.folder;
          resolvedFrom = added.resolvedFrom;
          setShown({ environmentId: id, detail: added.workspace });
        },
      );
      return error === null ? { folder, resolvedFrom } : { error };
    },
    setWorktreeVisible: (folder, worktree, visible) => {
      if (shown === null) return Promise.resolve("Open a workspace first.");
      return run(
        (id) =>
          visibilityCommand({
            environmentId: id,
            input: { name: shown.name, folder, worktree, visible },
          }),
        (detail, id) => setShown({ environmentId: id, detail }),
      );
    },
    folderGit: async (folder) => {
      if (shown === null) return { error: "Open a workspace first." };
      let git: WorkspaceFolderGit | null = null;
      const error = await run(
        (id) => folderGitCommand({ environmentId: id, input: { name: shown.name, folder } }),
        (value) => {
          git = value;
        },
      );
      return git === null
        ? { error: error ?? "The folder's worktrees could not be read." }
        : { git };
    },
    startShell: (folder, worktree, size) => {
      if (shown === null) return Promise.resolve("Open a workspace first.");
      const name = shown.name;
      return run(
        (id) =>
          startShellCommand({
            environmentId: id,
            input: {
              name,
              folder,
              ...(worktree === null ? {} : { worktree }),
              ...(size === null ? {} : size),
            },
          }),
        (shell, id) => {
          updateTabs(id, name, (current) => ({
            shellIds: [...current.shellIds, shell.shellId],
            activeShellId: shell.shellId,
          }));
          setShown((current) =>
            current === null || current.detail.name !== name
              ? current
              : {
                  ...current,
                  detail: {
                    ...current.detail,
                    lastStart: {
                      folder,
                      worktree:
                        worktree === null
                          ? { kind: "checkout" }
                          : worktree.kind === "new"
                            ? { kind: "new", startingPoint: worktree.startingPoint }
                            : worktree,
                    },
                  },
                },
          );
        },
        startFailure,
      );
    },
    activateShell: (shellId) => {
      if (shown === null || environmentId === null) return;
      updateTabs(environmentId, shown.name, (current) =>
        current.shellIds.includes(shellId)
          ? { ...current, activeShellId: shellId }
          : { shellIds: [...current.shellIds, shellId], activeShellId: shellId },
      );
    },
  };
}
