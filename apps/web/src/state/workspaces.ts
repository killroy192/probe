import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import { createWorkspaceEnvironmentAtoms } from "@t3tools/client-runtime/state/workspaces";
import {
  AuthOrchestrationReadScope,
  type EnvironmentId,
  type WorkspaceSummary,
} from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { usePrimaryEnvironmentId } from "./environments";
import { formatEnvironmentQueryError, useEnvironmentQuery } from "./query";
import { useEnvironmentScope } from "./session";
import { useAtomCommand } from "./use-atom-command";

const workspaceEnvironment = createWorkspaceEnvironmentAtoms(connectionAtomRuntime);

interface ShownWorkspace {
  readonly environmentId: EnvironmentId;
  readonly name: string;
}

// Kept in memory only: a reload returns to the start screen until story 7 restores it.
const shownWorkspaceAtom = Atom.make<ShownWorkspace | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("web-shown-workspace"),
);

/** Null on success, else the reason to show the user. */
type WorkspaceActionResult = Promise<string | null>;

export interface WorkspacesView {
  readonly environmentId: EnvironmentId | null;
  /** Null until the first list arrives. */
  readonly workspaces: ReadonlyArray<WorkspaceSummary> | null;
  readonly listError: string | null;
  /** The shown workspace, or null for the start screen. */
  readonly shown: WorkspaceSummary | null;
  readonly create: (name: string) => WorkspaceActionResult;
  readonly open: (name: string) => WorkspaceActionResult;
  readonly remove: (name: string) => WorkspaceActionResult;
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
  const shownState = useAtomValue(shownWorkspaceAtom);
  const setShown = useAtomSet(shownWorkspaceAtom);
  const createCommand = useAtomCommand(workspaceEnvironment.create, { reportFailure: false });
  const openCommand = useAtomCommand(workspaceEnvironment.open, { reportFailure: false });
  const removeCommand = useAtomCommand(workspaceEnvironment.remove, { reportFailure: false });

  const workspaces = query.data;
  // A workspace removed elsewhere stops being shown as soon as the list drops it.
  const shown =
    shownState !== null &&
    shownState.environmentId === environmentId &&
    workspaces?.some((workspace) => workspace.name === shownState.name)
      ? { name: shownState.name }
      : null;

  const run = async <A>(
    action: (environmentId: EnvironmentId) => Promise<AtomCommandResult<A, unknown>>,
    onSuccess: (value: A, environmentId: EnvironmentId) => void,
  ): WorkspaceActionResult => {
    if (environmentId === null) return "Not connected to an environment.";
    const result = await action(environmentId);
    if (result._tag === "Failure") return formatEnvironmentQueryError(result.cause);
    onSuccess(result.value, environmentId);
    return null;
  };

  return {
    environmentId,
    workspaces,
    listError: query.error,
    shown,
    create: (name) =>
      run(
        (id) => createCommand({ environmentId: id, input: { name } }),
        (created, id) => setShown({ environmentId: id, name: created.name }),
      ),
    open: (name) =>
      shown?.name === name
        ? Promise.resolve(null)
        : run(
            (id) => openCommand({ environmentId: id, input: { name } }),
            (opened, id) => setShown({ environmentId: id, name: opened.name }),
          ),
    remove: (name) =>
      run(
        (id) => removeCommand({ environmentId: id, input: { name } }),
        () => {
          if (shown?.name === name) setShown(null);
        },
      ),
  };
}
