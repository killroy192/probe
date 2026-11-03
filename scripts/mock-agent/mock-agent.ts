#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalRandom:off - Standalone terminal program that stands in for a Claude-Code-like CLI in scenarios.

import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeReadline from "node:readline";

// A session is a JSON-lines file of input lines in $MOCK_AGENT_HOME. Replies are derived from the
// input, so resuming only needs the inputs.
const stateDirectory = (): string =>
  NodeProcess.env.MOCK_AGENT_HOME ?? NodePath.join(NodeOS.tmpdir(), "probe-mock-agent");

const sessionFile = (id: string): string => NodePath.join(stateDirectory(), `${id}.jsonl`);

const reply = (line: string): string => `echo: ${line}`;

const out = (line: string): void => {
  NodeProcess.stdout.write(`${line}\n`);
};

function main(): void {
  const args = NodeProcess.argv.slice(2);
  const resumeIndex = args.indexOf("--resume");
  const resumeId = resumeIndex === -1 ? undefined : args[resumeIndex + 1];
  if (resumeIndex !== -1 && !resumeId) {
    NodeProcess.stderr.write("mock-agent: --resume needs a session id\n");
    NodeProcess.exit(2);
  }

  const id = resumeId ?? `mock-${NodeCrypto.randomBytes(4).toString("hex")}`;
  const file = sessionFile(id);
  let history: string[] = [];
  if (resumeId) {
    if (!NodeFS.existsSync(file)) {
      NodeProcess.stderr.write(`mock-agent: no session ${id}\n`);
      NodeProcess.exit(1);
    }
    history = NodeFS.readFileSync(file, "utf8")
      .split("\n")
      .filter((entry) => entry !== "")
      .map((entry) => JSON.parse(entry) as string);
  } else {
    NodeFS.mkdirSync(stateDirectory(), { recursive: true });
    NodeFS.writeFileSync(file, "");
  }

  out("Mock Agent v1");
  out(`session: ${id}`);
  for (const line of history) {
    out(`> ${line}`);
    out(reply(line));
  }

  const input = NodeReadline.createInterface({ input: NodeProcess.stdin });
  input.on("line", (line) => {
    if (line.trim() === "exit") {
      input.close();
      return;
    }
    NodeFS.appendFileSync(file, `${JSON.stringify(line)}\n`);
    out(reply(line));
  });
  input.on("close", () => NodeProcess.exit(0));
}

main();
