// Shared by the server and the `probe` command's fast path, so it imports nothing.

/** What Probe puts in every shell's environment so `probe kill` can end that shell. */
export const SHELL_ENV = {
  id: "PROBE_SHELL_ID",
  token: "PROBE_SHELL_TOKEN",
  /** Overrides the endpoint file; Probe itself does not set it. */
  endpoint: "PROBE_SHELL_ENDPOINT",
  /** Holds the current endpoint, rewritten at every server start, so a restarted server is found. */
  endpointFile: "PROBE_SHELL_ENDPOINT_FILE",
  /** The `probe` command's path, for a shell whose startup files reset PATH. */
  bin: "PROBE_BIN",
} as const;

export const SELF_KILL_PATH = "/api/shell/self/kill";

export interface ShellSelfKill {
  readonly endpointFile: string;
  readonly bin: string;
  /** The shell's PATH, with the `probe` command's folder first. */
  readonly path: string;
}

/** The server CLI's hidden subcommand the `probe` wrapper runs. */
export const PROBE_COMMAND = "__probe";
