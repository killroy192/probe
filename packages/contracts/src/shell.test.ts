import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { WS_METHODS, WsRpcGroup } from "./rpc.ts";
import { ShellOpenInput, ShellResizeInput, ShellSummary, shellOwnerId } from "./shell.ts";
import {
  TerminalAttachInput,
  TerminalCloseInput,
  TerminalOpenInput,
  TerminalWriteInput,
} from "./terminal.ts";

const decodeSummary = Schema.decodeUnknownSync(ShellSummary);

const decodes = (schema: Schema.Top, input: unknown) =>
  Exit.isSuccess(Schema.decodeUnknownExit(schema as never)(input));

describe("shell contracts", () => {
  it("opens a shell from a folder alone, with no thread", () => {
    expect(decodes(ShellOpenInput, { cwd: "/tmp/project" })).toBe(true);
    expect(decodes(ShellOpenInput, { cwd: "/tmp/project", cols: 80, rows: 24 })).toBe(true);
    expect(decodes(ShellOpenInput, {})).toBe(false);
  });

  it("rejects a size outside the terminal limits", () => {
    const resize = (cols: number, rows: number) =>
      decodes(ShellResizeInput, { shellId: "s1", cols, rows });
    expect(resize(80, 24)).toBe(true);
    expect(resize(0, 24)).toBe(false);
    expect(resize(1001, 24)).toBe(false);
    expect(resize(80, 501)).toBe(false);
  });

  it("lists a shell by its own id, not under a thread", () => {
    const summary = {
      shellId: "s1",
      cwd: "/tmp/project",
      status: "running",
      pid: 42,
      exitCode: null,
      exitSignal: null,
      label: "zsh",
      title: null,
      process: null,
      folder: null,
      worktree: null,
      branch: null,
      elsewhere: null,
      updatedAt: "2026-11-03T00:00:00.000Z",
    };
    expect(decodes(ShellSummary, summary)).toBe(true);
    expect(Object.keys(decodeSummary(summary))).not.toContain("threadId");
  });

  it("keeps shell owners apart from any chat thread id", () => {
    expect(shellOwnerId("s1")).not.toBe("s1");
    const owner = shellOwnerId("s1");
    for (const [schema, input] of [
      [TerminalOpenInput, { terminalId: "term-1", cwd: "/tmp/project" }],
      [TerminalAttachInput, { terminalId: "term-1" }],
      [TerminalWriteInput, { terminalId: "term-1", data: "x" }],
      [TerminalCloseInput, {}],
    ] as const) {
      expect(decodes(schema, { ...input, threadId: "thread-1" })).toBe(true);
      expect(decodes(schema, { ...input, threadId: owner })).toBe(false);
    }
  });

  it("registers a method for every shell operation", () => {
    for (const method of [
      WS_METHODS.shellOpen,
      WS_METHODS.shellAttach,
      WS_METHODS.shellWrite,
      WS_METHODS.shellResize,
      WS_METHODS.shellKill,
      WS_METHODS.subscribeShells,
    ]) {
      expect(WsRpcGroup.requests.has(method)).toBe(true);
    }
  });
});
