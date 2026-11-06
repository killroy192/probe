import { describe, expect, it } from "vite-plus/test";

import { runProbeShell } from "./probeShell.ts";

const shellEnv = { PROBE_SHELL_ENDPOINT_FILE: "/state/endpoint", PROBE_SHELL_TOKEN: "t" };
const files: Record<string, string> = { "/state/endpoint": "http://127.0.0.1:1/kill\n" };

const run = (
  args: ReadonlyArray<string>,
  env: Record<string, string>,
  fetch: (url: string, init: RequestInit) => Promise<Response>,
) => {
  let stderr = "";
  const readFile = async (path: string) => {
    const content = files[path];
    if (content === undefined) throw new Error(`ENOENT: ${path}`);
    return content;
  };
  return runProbeShell(args, { env, fetch, readFile, stderr: (text) => (stderr += text) }).then(
    (code) => ({
      code,
      stderr,
    }),
  );
};

describe("probe kill", () => {
  it("asks the server named in the endpoint file to kill this shell with its token", async () => {
    const calls: Array<[string, RequestInit]> = [];
    const result = await run(["kill"], shellEnv, async (url, init) => {
      calls.push([url, init]);
      return new Response(null, { status: 204 });
    });
    expect(result).toEqual({ code: 0, stderr: "" });
    expect(calls).toEqual([
      ["http://127.0.0.1:1/kill", { method: "POST", headers: { authorization: "Bearer t" } }],
    ]);
  });

  it.each([
    [
      "the server cannot be reached",
      shellEnv,
      () => Promise.reject(new Error("connect ECONNREFUSED")),
    ],
    ["the server refuses the token", shellEnv, async () => new Response(null, { status: 401 })],
    ["the shell is not a Probe shell", {}, () => Promise.reject(new Error("not called"))],
    [
      "the endpoint file is gone",
      { ...shellEnv, PROBE_SHELL_ENDPOINT_FILE: "/gone" },
      () => Promise.reject(new Error("not called")),
    ],
  ])("says the shell keeps running when %s", async (_case, env, fetch) => {
    const result = await run(["kill"], env, fetch);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(
      /^probe kill: could not reach Probe \(.+\); this shell keeps running\.\n$/,
    );
  });

  it("uses an endpoint given in the environment over the file", async () => {
    const urls: Array<string> = [];
    const env = { ...shellEnv, PROBE_SHELL_ENDPOINT: "http://127.0.0.1:9/kill" };
    await run(["kill"], env, async (url) => {
      urls.push(url);
      return new Response(null, { status: 204 });
    });
    expect(urls).toEqual(["http://127.0.0.1:9/kill"]);
  });

  it("prints its usage for anything else", async () => {
    const result = await run(["stop"], shellEnv, () => Promise.reject(new Error("not called")));
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("usage: probe kill");
  });
});
