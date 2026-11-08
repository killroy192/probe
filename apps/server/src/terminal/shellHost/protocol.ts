// @effect-diagnostics nodeBuiltinImport:off - Shared by the shell host process, which loads no Effect.
import * as NodeCrypto from "node:crypto";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

/** Bumped on any wire change; a host speaking another version is left alone. */
export const SHELL_HOST_PROTOCOL = 1;

/** The hidden `bin.ts` command that runs the host. */
export const SHELL_HOST_COMMAND = "__shell-host";

// Unix socket paths are capped near 104 bytes (macOS) and 108 (Linux), including the terminator.
const MAX_SOCKET_PATH = 100;

/** Where the host of this state folder listens; a long state path falls back to the temp folder. */
export const shellHostSocketPath = (stateDir: string) => {
  const preferred = NodePath.join(stateDir, `shell-host-v${SHELL_HOST_PROTOCOL}.sock`);
  if (Buffer.byteLength(preferred) <= MAX_SOCKET_PATH) return preferred;
  const digest = NodeCrypto.createHash("sha256").update(stateDir).digest("hex").slice(0, 12);
  return NodePath.join(NodeOS.tmpdir(), `probe-shell-${digest}-v${SHELL_HOST_PROTOCOL}.sock`);
};

/** The host writes its pid here, so whoever owns the state folder can stop it by that pid. */
export const shellHostPidPath = (stateDir: string) =>
  NodePath.join(stateDir, `shell-host-v${SHELL_HOST_PROTOCOL}.pid`);

/** Where a host that failed to start says why. */
export const shellHostLogPath = (stateDir: string) =>
  NodePath.join(stateDir, `shell-host-v${SHELL_HOST_PROTOCOL}.log`);

export interface HostExit {
  readonly exitCode: number;
  readonly signal: number | null;
}

/** The PTY's grid from offset `at` of a session's `output` on. */
export interface HostGrid {
  readonly at: number;
  readonly cols: number;
  readonly rows: number;
}

export interface HostSession {
  readonly id: string;
  readonly pid: number;
  readonly cwd: string;
  readonly cols: number;
  readonly rows: number;
  /** The output the host kept, oldest first. */
  readonly output: string;
  /** The grids `output` was printed at, oldest first. A host from before these sends none. */
  readonly grids?: ReadonlyArray<HostGrid>;
  readonly exit: HostExit | null;
}

export type ClientMessage =
  | { readonly t: "hello"; readonly version: number }
  | {
      readonly t: "spawn";
      readonly req: number;
      readonly shell: string;
      readonly args: ReadonlyArray<string>;
      readonly cwd: string;
      readonly cols: number;
      readonly rows: number;
      readonly env: Readonly<Record<string, string>>;
    }
  | { readonly t: "list"; readonly req: number }
  | { readonly t: "write"; readonly id: string; readonly data: string }
  | { readonly t: "resize"; readonly id: string; readonly cols: number; readonly rows: number }
  | { readonly t: "signal"; readonly id: string; readonly signal: string | null }
  | { readonly t: "forget"; readonly id: string };

export type HostMessage =
  | { readonly t: "hello"; readonly version: number; readonly pid: number }
  | { readonly t: "spawned"; readonly req: number; readonly id: string; readonly pid: number }
  | { readonly t: "spawnFailed"; readonly req: number; readonly message: string }
  | { readonly t: "sessions"; readonly req: number; readonly sessions: ReadonlyArray<HostSession> }
  | { readonly t: "data"; readonly id: string; readonly data: string }
  | ({ readonly t: "exit"; readonly id: string } & HostExit);

/** Splits a socket's text into JSON lines, keeping a partial line for the next chunk. */
export const lineReader = (onMessage: (message: unknown) => void) => {
  let pending = "";
  return (chunk: string) => {
    pending += chunk;
    let newline = pending.indexOf("\n");
    while (newline !== -1) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      if (line.length > 0) onMessage(JSON.parse(line));
      newline = pending.indexOf("\n");
    }
  };
};

export const encodeLine = (message: ClientMessage | HostMessage) => `${JSON.stringify(message)}\n`;
