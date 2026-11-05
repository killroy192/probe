import { describe, expect, it } from "vite-plus/test";

import { isServerRemote } from "./serverLocation";

describe("isServerRemote", () => {
  it.each([
    ["the desktop app's own server", true, "linux", "Linux x86_64", "example.com", false],
    ["a container server seen from a Mac", false, "linux", "MacIntel", "localhost", true],
    ["npx t3 on this Mac", false, "darwin", "MacIntel", "localhost", false],
    ["a server reached by name", false, "darwin", "MacIntel", "box.tailnet.ts.net", true],
    ["an unknown server OS on loopback", false, null, "MacIntel", "127.0.0.1", false],
  ] as const)("%s", (_name, desktopOwnServer, serverOs, clientPlatform, pageHost, remote) => {
    expect(isServerRemote({ desktopOwnServer, serverOs, clientPlatform, pageHost })).toBe(remote);
  });
});
