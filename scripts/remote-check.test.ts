// @effect-diagnostics nodeBuiltinImport:off - Drives the real shell check against a fake server.
import * as NodeChildProcess from "node:child_process";
import * as NodeHttp from "node:http";
import * as NodeNet from "node:net";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

const SCRIPT = NodePath.resolve(import.meta.dirname, "remote-check.sh");
const TOKEN = "PRBTOKEN1234";

interface Request {
  readonly method: string;
  readonly url: string;
  readonly body: string;
}

// Answers like an installed server: readiness, and a single-use token exchange.
const fakeServer = async () => {
  const requests: Array<Request> = [];
  let spent = false;
  const server = NodeHttp.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString()));
    request.on("end", () => {
      requests.push({ method: request.method ?? "", url: request.url ?? "", body });
      if (request.method === "GET" && request.url === "/.well-known/t3/environment") {
        response.statusCode = 200;
      } else if (request.method === "POST" && request.url === "/api/auth/browser-session") {
        const valid = !spent && JSON.parse(body).credential === TOKEN;
        spent ||= valid;
        response.statusCode = valid ? 200 : 401;
      } else {
        response.statusCode = 404;
      }
      response.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as NodeNet.AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    [Symbol.asyncDispose]: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
};

// Async, so the fake server in this process keeps answering while the script runs.
const check = (args: ReadonlyArray<string>, stdin = "") =>
  new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = NodeChildProcess.spawn("sh", [SCRIPT, ...args], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, output }));
    child.stdin.end(stdin);
  });

const closedPort = () =>
  new Promise<number>((resolve) => {
    const server = NodeNet.createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as NodeNet.AddressInfo;
      server.close(() => resolve(port));
    });
  });

describe("remote-check.sh", () => {
  it("passes with the token from stdin, sends it as the credential and never prints it", async () => {
    await using server = await fakeServer();
    const result = await check([server.origin], `${TOKEN}\n`);
    expect(result.code).toBe(0);
    expect(result.output).toContain("/.well-known/t3/environment -> 200");
    expect(result.output).toContain("/api/auth/browser-session -> 200");
    expect(result.output).toContain(`PASS ${server.origin}`);
    expect(result.output).not.toContain(TOKEN);
    expect(JSON.parse(server.requests[1]!.body)).toEqual({ credential: TOKEN });
  });

  it("fails on a refused or spent token and names the code", async () => {
    await using server = await fakeServer();
    expect((await check([server.origin, TOKEN])).code).toBe(0);
    const spent = await check([server.origin, TOKEN]);
    expect(spent.code).toBe(1);
    expect(spent.output).toContain("/api/auth/browser-session -> 401");
    expect(spent.output).toContain("FAIL");
    expect(spent.output).not.toContain(TOKEN);
  });

  it("fails without spending the token when nothing answers", async () => {
    const result = await check([`http://127.0.0.1:${await closedPort()}`, TOKEN]);
    expect(result.code).toBe(1);
    expect(result.output).toContain("/.well-known/t3/environment -> 000");
    expect(result.output).toContain("skipped (token not spent)");
    expect(result.output).not.toContain(TOKEN);
  });

  it("refuses misuse before sending anything", async () => {
    await using server = await fakeServer();
    expect((await check([server.origin], "")).code).toBe(2);
    expect((await check(["127.0.0.1:3773", TOKEN])).code).toBe(2);
    expect(server.requests).toHaveLength(0);
  });
});
