const CLIENT_OS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^mac/i, "darwin"],
  [/^win/i, "win32"],
  [/linux/i, "linux"],
];

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Whether folders picked in the modal live on another machine than this client. The desktop
 * app's own server is local; otherwise a different OS or a non-loopback page host means remote.
 * A server on this machine reached through a tunnel cannot be told apart and counts as remote.
 */
export function isServerRemote(input: {
  readonly desktopOwnServer: boolean;
  readonly serverOs: string | null;
  readonly clientPlatform: string;
  readonly pageHost: string;
}): boolean {
  if (input.desktopOwnServer) return false;
  const clientOs = CLIENT_OS.find(([pattern]) => pattern.test(input.clientPlatform))?.[1] ?? null;
  if (input.serverOs !== null && clientOs !== null && input.serverOs !== clientOs) return true;
  return !LOOPBACK_HOSTS.has(input.pageHost.toLowerCase());
}
