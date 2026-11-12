import { useAtomValue } from "@effect/atom-react";
import {
  createShellEnvironmentAtoms,
  EMPTY_TERMINAL_BUFFER_STATE,
  EMPTY_TERMINAL_SESSION_STATE,
  combineTerminalSessionState,
  type TerminalSessionState,
} from "@t3tools/client-runtime/state/terminal";
import {
  AuthTerminalOperateScope,
  AuthTerminalReadScope,
  type EnvironmentId,
  type ShellId,
  type ShellSummary,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { formatEnvironmentQueryError, useEnvironmentQuery } from "./query";
import { environmentSession, sessionHasScope, useEnvironmentScope } from "./session";

export const shellEnvironment = createShellEnvironmentAtoms(connectionAtomRuntime);

const EMPTY_SHELL_SESSION_ATOM = Atom.make(EMPTY_TERMINAL_SESSION_STATE).pipe(
  Atom.withLabel("web-shell-session:empty"),
);

const attachedShellSessionFamily = Atom.family((key: string) => {
  const [environmentId, shellId] = JSON.parse(key) as [EnvironmentId, ShellId];
  const attachAtom = shellEnvironment.attach({ environmentId, input: { shellId } });
  // Refreshing reattaches, so the server sends a fresh snapshot.
  return Atom.readable(
    (get): TerminalSessionState => {
      const session = get(environmentSession.sessionStateAtom(environmentId));
      // Shells have no read-only observe stream; viewing one requires operate.
      if (!sessionHasScope(session, AuthTerminalOperateScope)) {
        return {
          ...EMPTY_TERMINAL_SESSION_STATE,
          status: "error",
          error: "You do not have permission to use shells here.",
        };
      }
      const attach = get(attachAtom);
      const state = combineTerminalSessionState(
        null,
        AsyncResult.getOrElse(attach, () => EMPTY_TERMINAL_BUFFER_STATE),
      );
      return attach._tag === "Failure"
        ? { ...state, error: formatEnvironmentQueryError(attach.cause), status: "error" }
        : state;
    },
    (refresh) => refresh(attachAtom),
  ).pipe(Atom.withLabel(`web-shell-session:${key}`));
});

/** One shown shell's attach buffer, in the shape the terminal surface reads. */
export function attachedShellSessionAtom(
  environmentId: EnvironmentId | null,
  shellId: ShellId | null,
): Atom.Atom<TerminalSessionState> {
  if (environmentId === null || shellId === null) return EMPTY_SHELL_SESSION_ATOM;
  return attachedShellSessionFamily(JSON.stringify([environmentId, shellId]));
}

export function useShells(environmentId: EnvironmentId | null): {
  readonly shells: ReadonlyArray<ShellSummary> | null;
  readonly error: string | null;
} {
  const canRead = useEnvironmentScope(environmentId, AuthTerminalReadScope);
  const query = useEnvironmentQuery(
    environmentId === null || !canRead
      ? null
      : shellEnvironment.list({ environmentId, input: null }),
  );
  return { shells: query.data, error: query.error };
}

/** Which running shells show the restored mark; `unseen` were already restored in the first list. */
export interface RestoredMarks {
  readonly unseen: ReadonlySet<ShellId>;
  readonly shown: ReadonlySet<ShellId>;
}

const NO_RESTORED_MARKS: RestoredMarks = { unseen: new Set(), shown: new Set() };

/**
 * The page marks only restores it saw happen, so a reload never shows an earlier one. Null until
 * the first list (`shells` null while it loads), whose restores count as seen before the page.
 */
export function nextRestoredMarks(
  previous: RestoredMarks | null,
  shells: ReadonlyArray<ShellSummary> | null,
): RestoredMarks | null {
  if (shells === null) return previous;
  const marked = shells.flatMap((shell) =>
    shell.restored && shell.ended === null ? [shell.shellId] : [],
  );
  const unseen = new Set(
    previous === null ? marked : marked.filter((shellId) => previous.unseen.has(shellId)),
  );
  return { unseen, shown: new Set(marked.filter((shellId) => !unseen.has(shellId))) };
}

const EMPTY_RESTORED_MARKS_ATOM = Atom.make(NO_RESTORED_MARKS).pipe(
  Atom.withLabel("web-shell-restored-marks:empty"),
);

const restoredMarksFamily = Atom.family((environmentId: EnvironmentId) => {
  const listAtom = shellEnvironment.list({ environmentId, input: null });
  return Atom.make((get) =>
    nextRestoredMarks(
      Option.getOrNull(get.self<RestoredMarks | null>()),
      AsyncResult.getOrElse(get(listAtom), () => null),
    ),
  ).pipe(Atom.withLabel(`web-shell-restored-marks:${environmentId}`));
});

/** The shells whose row shows the restored mark. */
export function useRestoredMarks(environmentId: EnvironmentId | null): ReadonlySet<ShellId> {
  const canRead = useEnvironmentScope(environmentId, AuthTerminalReadScope);
  return (
    useAtomValue(
      environmentId === null || !canRead
        ? EMPTY_RESTORED_MARKS_ATOM
        : restoredMarksFamily(environmentId),
    )?.shown ?? NO_RESTORED_MARKS.shown
  );
}
