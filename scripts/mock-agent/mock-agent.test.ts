// @effect-diagnostics nodeBuiltinImport:off - Spawns the standalone mock agent as a real subprocess.

import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

const mockAgent = NodeURL.fileURLToPath(new URL("./mock-agent.ts", import.meta.url));

const run = (home: string, args: ReadonlyArray<string>, input: string) =>
  new Promise<{ readonly stdout: string; readonly code: number | null }>((resolve, reject) => {
    const child = NodeChildProcess.spawn("node", [mockAgent, ...args], {
      env: { ...process.env, MOCK_AGENT_HOME: home },
      stdio: ["pipe", "pipe", "inherit"],
    });
    let stdout = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.once("error", reject);
    child.once("exit", (code) => resolve({ stdout, code }));
    child.stdin.end(input);
  });

const sessionId = (stdout: string) => /^session: (\S+)$/m.exec(stdout)?.[1];

it.live("echoes input, ends on exit, and resumes the same conversation", () =>
  Effect.promise(async () => {
    const home = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "mock-agent-test-"));
    try {
      const first = await run(home, [], "hello\nworld\nexit\nignored\n");
      const id = sessionId(first.stdout);
      assert.isDefined(id);
      assert.strictEqual(first.code, 0);
      assert.strictEqual(first.stdout.match(/Mock Agent/g)?.length, 1);
      assert.include(first.stdout, "echo: hello\necho: world\n");
      assert.notInclude(first.stdout, "ignored");

      const second = await run(home, ["--resume", id!], "again\nexit\n");
      assert.strictEqual(second.code, 0);
      assert.strictEqual(sessionId(second.stdout), id);
      assert.include(second.stdout, "> hello\necho: hello\n> world\necho: world\n");
      assert.include(second.stdout, "echo: again\n");

      const third = await run(home, ["--resume", id!], "exit\n");
      assert.include(third.stdout, "> again\necho: again\n");
    } finally {
      await NodeFSP.rm(home, { recursive: true, force: true });
    }
  }),
);
