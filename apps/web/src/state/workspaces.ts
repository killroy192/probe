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
  type StartingScript,
  type StartingScriptChoice,
  type WorkspaceDetail,
  type WorkspaceProjectGit,
  type WorkspaceSummary,
  type WorkspaceTabs as SavedWorkspaceTabs,
  type WorkspaceWorktreeChoice,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";
import { Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { usePrimaryEnvironmentId } from "./environments";
import { formatEnvironmentQueryError, useEnvironmentQuery } from "./query";
import { useEnvironmentScope, useEnvironmentScopesKnown } from "./session";
import { shellEnvironment, useShells } from "./shells";
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

const fromSaved = (saved: SavedWorkspaceTabs): WorkspaceTabs => ({
  shellIds: saved.shellIds as ReadonlyArray<ShellId>,
  activeShellId: saved.active as ShellId | null,
});

// Per browser: which workspace this page showed last, so a reload shows it again.
const SHOWN_KEY_PREFIX = "probe:shown-workspace:";

const rememberShown = (environmentId: EnvironmentId, name: string | null) => {
  try {
    if (name === null) localStorage.removeItem(SHOWN_KEY_PREFIX + environmentId);
    else localStorage.setItem(SHOWN_KEY_PREFIX + environmentId, name);
  } catch {
    // Storage can be blocked; the page then starts on the start screen after a reload.
  }
};

const rememberedShown = (environmentId: EnvironmentId) => {
  try {
    return localStorage.getItem(SHOWN_KEY_PREFIX + environmentId);
  } catch {
    return null;
  }
};

const shownWorkspaceAtom = Atom.make<ShownWorkspace | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("web-shown-workspace"),
);

const tabsAtom = Atom.make<Readonly<Record<string, WorkspaceTabs>>>({}).pipe(
  Atom.keepAlive,
  Atom.withLabel("web-workspace-tabs"),
);

// Why the last tab change was not saved; cleared by the next one that is.
const layoutErrorAtom = Atom.make<string | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("web-workspace-layout-error"),
);

// The latest tabs of each workspace and the save in flight, so quick changes build on each
// other and reach the server in order (the last save wins there).
const latestTabs = new Map<string, WorkspaceTabs>();
const pendingSaves = new Map<string, Promise<unknown>>();

// How many tab saves of each workspace this page has in flight; a workspace not listed has none.
const savingAtom = Atom.make<Readonly<Record<string, number>>>({}).pipe(
  Atom.keepAlive,
  Atom.withLabel("web-workspace-layout-saving"),
);

// The workspaces whose last tab save from this page failed.
const saveFailedAtom = Atom.make<Readonly<Record<string, true>>>({}).pipe(
  Atom.keepAlive,
  Atom.withLabel("web-workspace-layout-save-failed"),
);

// Whether this page already tried to show the workspace it showed before a reload.
const restoredAtom = Atom.make<"no" | "pending" | "done">("no").pipe(
  Atom.keepAlive,
  Atom.withLabel("web-workspace-restored"),
);

/** The tabs without `shellId`; closing the active tab shows its right neighbour, else its left. */
const withoutTab = (tabs: WorkspaceTabs, shellId: ShellId): WorkspaceTabs => {
  const index = tabs.shellIds.indexOf(shellId);
  if (index < 0) return tabs;
  const shellIds = tabs.shellIds.filter((id) => id !== shellId);
  return {
    shellIds,
    activeShellId:
      tabs.activeShellId === shellId
        ? (shellIds[index] ?? shellIds[index - 1] ?? null)
        : tabs.activeShellId,
  };
};

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

export type AddProjectRequest =
  | { readonly mode: "import"; readonly path: string }
  | { readonly mode: "create"; readonly parentPath: string; readonly folderName: string };

export interface WorkspacesView {
  readonly environmentId: EnvironmentId | null;
  /** Null until the first list arrives. */
  readonly workspaces: ReadonlyArray<WorkspaceSummary> | null;
  readonly listError: string | null;
  /** Whether this client may create and remove workspaces and add projects (settings write). */
  readonly canChange: boolean;
  /** False while canChange is still unknown, so gated items can hold their place disabled. */
  readonly canChangeKnown: boolean;
  /** Whether this client may start shells (terminal operate). */
  readonly canStartShell: boolean;
  /** The shown workspace, or null for the start screen. */
  readonly shown: WorkspaceDetail | null;
  readonly tabs: WorkspaceTabs;
  /** Why the open tabs are not being saved, or null while they are. */
  readonly layoutError: string | null;
  /**
   * The shown workspace's tabs as this page last changed them: still being saved, saved, or the
   * last save failed. Saved until this page changes them; another client's change never counts.
   */
  readonly layoutSave: "pending" | "saved" | "failed";
  readonly create: (name: string) => WorkspaceActionResult;
  readonly open: (name: string) => WorkspaceActionResult;
  /** Reads the shown workspace again, so a project whose folder was deleted on disk is no longer preselected. */
  readonly refresh: () => WorkspaceActionResult;
  readonly remove: (name: string) => WorkspaceActionResult;
  /** The added project's path, or the reason it was not added. */
  readonly addProject: (
    request: AddProjectRequest,
  ) => Promise<
    { readonly project: string; readonly resolvedFrom: string | null } | { readonly error: string }
  >;
  /** Removes a project from the shown workspace and kills its shells; its folder stays on disk. */
  readonly removeProject: (project: string) => WorkspaceActionResult;
  /** A git project's worktrees, branches and a fresh worktree name, read anew on each call. */
  readonly projectGit: (
    project: string,
  ) => Promise<{ readonly git: WorkspaceProjectGit } | { readonly error: string }>;
  /** The user's starting scripts, read anew on each call; a damaged list reads as empty. */
  readonly startingScripts: () => Promise<ReadonlyArray<StartingScript>>;
  /** Adds and shows a tab only once the server has a running shell; a null script is a plain shell. */
  readonly startShell: (
    project: string,
    worktree: WorkspaceWorktreeChoice | null,
    script: StartingScriptChoice | null,
    size: { readonly cols: number; readonly rows: number } | null,
  ) => WorkspaceActionResult;
  /** Opens the shell's tab, or switches to it. */
  readonly activateShell: (shellId: ShellId) => void;
  /** Hides the shell's tab; the shell keeps running and stays in the tree. */
  readonly closeTab: (shellId: ShellId) => void;
  /** Ends the shell and everything it started, and closes its tab. */
  readonly killShell: (shellId: ShellId) => WorkspaceActionResult;
  /** Starts an ended shell again in the same place; a tab that was open comes back, a closed one stays closed. */
  readonly restoreShell: (shellId: ShellId) => WorkspaceActionResult;
  /** Shows the workspace this page showed before a reload, once per page. */
  readonly restoreShown: () => void;
  /** True while the page may still bring back the workspace it showed before a reload. */
  readonly restoring: boolean;
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
  const addProjectCommand = useAtomCommand(workspaceEnvironment.addProject, {
    reportFailure: false,
  });
  const removeProjectCommand = useAtomCommand(workspaceEnvironment.removeProject, {
    reportFailure: false,
  });
  const projectGitCommand = useAtomCommand(workspaceEnvironment.projectGit, {
    reportFailure: false,
  });
  const startingScriptsCommand = useAtomCommand(workspaceEnvironment.startingScripts, {
    reportFailure: false,
  });
  const startShellCommand = useAtomCommand(workspaceEnvironment.startShell, {
    reportFailure: false,
  });
  const killCommand = useAtomCommand(shellEnvironment.kill, { reportFailure: false });
  const restoreCommand = useAtomCommand(shellEnvironment.restore, { reportFailure: false });
  const saveTabsCommand = useAtomCommand(workspaceEnvironment.saveTabs, { reportFailure: false });
  const layoutError = useAtomValue(layoutErrorAtom);
  const setLayoutError = useAtomSet(layoutErrorAtom);
  const saving = useAtomValue(savingAtom);
  const setSaving = useAtomSet(savingAtom);
  const saveFailed = useAtomValue(saveFailedAtom);
  const setSaveFailed = useAtomSet(saveFailedAtom);
  const restored = useAtomValue(restoredAtom);
  const setRestored = useAtomSet(restoredAtom);
  const canChange = useAtomValue(workspaceEnvironment.create.permissionAtom(environmentId));
  const canChangeKnown = useEnvironmentScopesKnown(environmentId);
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
  // A shell the server no longer has, or one listed only as ended, leaves its tab.
  const liveShellIds =
    shells === null
      ? storedTabs.shellIds
      : storedTabs.shellIds.filter((id) =>
          shells.some((shell) => shell.shellId === id && shell.ended === null),
        );
  const tabs: WorkspaceTabs = {
    shellIds: liveShellIds,
    activeShellId:
      storedTabs.activeShellId !== null && liveShellIds.includes(storedTabs.activeShellId)
        ? storedTabs.activeShellId
        : (liveShellIds.at(-1) ?? null),
  };

  /** Changes a workspace's tabs and saves them with the workspace. */
  const updateTabs = (
    id: EnvironmentId,
    name: string,
    update: (tabs: WorkspaceTabs) => WorkspaceTabs,
  ) => {
    const key = tabsKey(id, name);
    const next = update(latestTabs.get(key) ?? allTabs[key] ?? NO_TABS);
    latestTabs.set(key, next);
    setAllTabs((all) => ({ ...all, [key]: next }));
    const count = (delta: number) =>
      setSaving((all) => {
        const next = { ...all, [key]: (all[key] ?? 0) + delta };
        if (next[key] === 0) delete next[key];
        return next;
      });
    count(1);
    const settle = (error: string | null) => {
      setLayoutError(error);
      setSaveFailed((all) => {
        if ((all[key] === true) === (error !== null)) return all;
        const next = { ...all };
        if (error === null) delete next[key];
        else next[key] = true;
        return next;
      });
    };
    const save = (pendingSaves.get(key) ?? Promise.resolve())
      .then(() =>
        saveTabsCommand({
          environmentId: id,
          input: { name, tabs: { shellIds: next.shellIds, active: next.activeShellId } },
        }),
      )
      .then((result) =>
        settle(
          result._tag === "Failure"
            ? `The layout is not being saved: ${formatEnvironmentQueryError(result.cause)}`
            : null,
        ),
      )
      // A save that throws must not stop the ones queued after it.
      .catch((error: unknown) => settle(`The layout is not being saved: ${String(error)}`))
      .finally(() => count(-1));
    pendingSaves.set(key, save);
  };

  const showDetail = (id: EnvironmentId, detail: WorkspaceDetail) => {
    setShown({ environmentId: id, detail });
    rememberShown(id, detail.name);
    // Reading the shown workspace again keeps this page's tabs, which may be newer than the file.
    if (shownState?.environmentId === id && shownState.detail.name === detail.name) return;
    const tabs = fromSaved(detail.tabs);
    latestTabs.set(tabsKey(id, detail.name), tabs);
    setAllTabs((all) => ({ ...all, [tabsKey(id, detail.name)]: tabs }));
  };

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
      // The file has this page's last tab change once its saves are done.
      async (id) => {
        await pendingSaves.get(tabsKey(id, name));
        return openCommand({ environmentId: id, input: { name } });
      },
      (detail, id) => showDetail(id, detail),
    );

  return {
    environmentId,
    workspaces,
    listError: query.error,
    canChange,
    canChangeKnown,
    canStartShell,
    shown,
    tabs,
    layoutError,
    layoutSave:
      shown === null || environmentId === null
        ? "saved"
        : saving[tabsKey(environmentId, shown.name)]
          ? "pending"
          : saveFailed[tabsKey(environmentId, shown.name)]
            ? "failed"
            : "saved",
    create: (name) =>
      run(
        (id) => createCommand({ environmentId: id, input: { name } }),
        (created, id) =>
          showDetail(id, {
            name: created.name,
            projects: [],
            lastStarts: {},
            tabs: { shellIds: [], active: null },
          }),
      ),
    open: (name) => (shown?.name === name ? Promise.resolve(null) : show(name)),
    refresh: () => (shown === null ? Promise.resolve(null) : show(shown.name)),
    remove: (name) =>
      run(
        (id) => removeCommand({ environmentId: id, input: { name } }),
        (_, id) => {
          if (shown?.name !== name) return;
          setShown(null);
          rememberShown(id, null);
        },
      ),
    addProject: async (request) => {
      if (shown === null) return { error: "Open a workspace first." };
      let project = "";
      let resolvedFrom: string | null = null;
      const error = await run(
        (id) => addProjectCommand({ environmentId: id, input: { ...request, name: shown.name } }),
        (added, id) => {
          project = added.project;
          resolvedFrom = added.resolvedFrom;
          setShown({ environmentId: id, detail: added.workspace });
        },
      );
      return error === null ? { project, resolvedFrom } : { error };
    },
    removeProject: (project) => {
      if (shown === null) return Promise.resolve("Open a workspace first.");
      const name = shown.name;
      return run(
        (id) => removeProjectCommand({ environmentId: id, input: { name, project } }),
        (detail, id) => setShown({ environmentId: id, detail }),
      );
    },
    projectGit: async (project) => {
      if (shown === null) return { error: "Open a workspace first." };
      let git: WorkspaceProjectGit | null = null;
      const error = await run(
        (id) => projectGitCommand({ environmentId: id, input: { name: shown.name, project } }),
        (value) => {
          git = value;
        },
      );
      return git === null
        ? { error: error ?? "The project's worktrees could not be read." }
        : { git };
    },
    // The list lives on the server that serves the UI; today that is also the workspace's server.
    startingScripts: async () => {
      let scripts: ReadonlyArray<StartingScript> = [];
      await run(
        (id) => startingScriptsCommand({ environmentId: id, input: {} }),
        (list) => {
          scripts = list.scripts;
        },
      );
      return scripts;
    },
    startShell: (project, worktree, script, size) => {
      if (shown === null) return Promise.resolve("Open a workspace first.");
      const name = shown.name;
      return run(
        (id) =>
          startShellCommand({
            environmentId: id,
            input: {
              name,
              project,
              ...(worktree === null ? {} : { worktree }),
              ...(script === null ? {} : { script }),
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
                    lastStarts: {
                      ...current.detail.lastStarts,
                      [project]: {
                        worktree:
                          worktree === null
                            ? { kind: "checkout" }
                            : worktree.kind === "new"
                              ? { kind: "new", startingPoint: worktree.startingPoint }
                              : worktree,
                        ...(script === null ? {} : { script: script.id }),
                      },
                    },
                  },
                },
          );
        },
        startFailure,
      );
    },
    closeTab: (shellId) => {
      if (shown === null || environmentId === null) return;
      updateTabs(environmentId, shown.name, (current) => withoutTab(current, shellId));
    },
    killShell: (shellId) => {
      if (shown === null) return Promise.resolve("Open a workspace first.");
      const name = shown.name;
      return run(
        (id) => killCommand({ environmentId: id, input: { shellId } }),
        (_, id) => {
          updateTabs(id, name, (current) => withoutTab(current, shellId));
          // A project whose folder is gone leaves the workspace with its last shell.
          void show(name);
        },
      );
    },
    restoreShell: (shellId) =>
      run(
        (id) => restoreCommand({ environmentId: id, input: { shellId } }),
        () => undefined,
      ),
    restoreShown: () => {
      if (restored !== "no" || environmentId === null || workspaces === null) return;
      if (shownState !== null) return setRestored("done");
      const name = rememberedShown(environmentId);
      if (name === null || !workspaces.some((workspace) => workspace.name === name)) {
        return setRestored("done");
      }
      setRestored("pending");
      void show(name).finally(() => setRestored("done"));
    },
    // The start screen would flash before the remembered workspace shows.
    restoring:
      restored !== "done" &&
      shownState === null &&
      canRead &&
      query.error === null &&
      (environmentId === null || rememberedShown(environmentId) !== null),
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
