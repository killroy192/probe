import { describe, expect, it } from "vite-plus/test";

import { loadGhosttyRuntime } from "./node.ts";
import { GhosttyVtTerminal } from "./terminal.ts";

const runtime = await loadGhosttyRuntime();
const SCROLLBACK = 1024 * 1024;

const terminal = (cols: number, rows: number) =>
  GhosttyVtTerminal.create(runtime, cols, rows, SCROLLBACK);

/** Replays `data` into a fresh terminal at `cols` × `rows`, as a client does with a snapshot. */
const replay = (data: string, cols: number, rows: number) => {
  const fresh = terminal(cols, rows);
  fresh.write(data);
  return fresh;
};

const count = (text: string, part: string) => text.split(part).length - 1;

describe("GhosttyVtTerminal", () => {
  it("formats a screen that replays to the same text", () => {
    const source = terminal(20, 4);
    source.write("one\r\ntwo\r\nthree");
    const copy = replay(source.format("vt"), 20, 4);
    expect(copy.format("plain")).toBe(source.format("plain"));
    expect(copy.format("plain")).toContain("one\ntwo\nthree");
  });

  it("keeps the cursor and the current style, so live output continues in place", () => {
    const source = terminal(20, 4);
    source.write("ab\x1b[1;31mcd");
    const copy = replay(source.format("vt"), 20, 4);
    // Output after the snapshot lands where it would have in the source.
    source.write("ef");
    copy.write("ef");
    expect(copy.format("vt")).toBe(source.format("vt"));
  });

  it("keeps custom tab stops, and the cursor where it was", () => {
    const source = terminal(20, 4);
    // Clear every tab stop, set one at column 4, and leave the cursor at column 2.
    source.write("\x1b[3g\x1b[4G\x1bH\rab");
    const copy = replay(source.format("vt"), 20, 4);
    source.write("\tX");
    copy.write("\tX");
    expect(copy.format("plain")).toBe(source.format("plain"));
    expect(copy.format("plain")).toContain("ab X");
  });

  // At the last column the cursor waits to wrap; the next character starts the next row.
  it("keeps a pending wrap at the end of a full row", () => {
    const source = terminal(10, 4);
    // The last cell keeps its own colour; the pen after it is reset.
    source.write("012345678\x1b[31m9\x1b[0m");
    const copy = replay(source.format("vt"), 10, 4);
    source.write("next");
    copy.write("next");
    expect(copy.format("vt")).toBe(source.format("vt"));
    expect(copy.format("plain")).toContain("0123456789\nnext");
  });

  it("keeps the alternate screen and input modes", () => {
    const source = terminal(20, 4);
    source.write("\x1b[?1049h\x1b[?1h\x1b[?2004hin vim");
    const copy = replay(source.format("vt"), 20, 4);
    expect(copy.isAlternateScreen()).toBe(true);
    expect(copy.mode(1)).toBe(true);
    expect(copy.mode(2004)).toBe(true);
    expect(copy.format("plain")).toContain("in vim");
  });

  it("keeps scrollback", () => {
    const source = terminal(20, 4);
    source.write(Array.from({ length: 50 }, (_, index) => `line ${index}`).join("\r\n"));
    const copy = replay(source.format("vt"), 20, 4);
    expect(copy.format("plain")).toContain("line 0\n");
    expect(copy.format("plain")).toContain("line 49");
  });

  // PRB.T-010: zsh redraws its line in place on every resize. Raw output replayed at a narrower
  // grid leaves each wide redraw behind; the formatted screen has only the line as it is now.
  // The prompt leads with the mark Probe's shell wrapper adds, which clears it on a live resize.
  it("replays one copy of a prompt that was redrawn at wider grids", () => {
    const prompt = "\x1b]133;A;redraw=1\x07vscode ➜ ~/repo (main) $ echo typed but not run";
    const redraw = `\r\r\x1b[0m\x1b[27m\x1b[24m\x1b[J${prompt}`;
    const source = terminal(120, 10);
    let raw = prompt;
    source.write(prompt);
    for (const cols of [100, 120, 110, 25]) {
      source.resize(cols, 10);
      source.write(redraw);
      raw += redraw;
    }
    expect(count(replay(raw, 25, 10).format("plain"), "vscode ➜")).toBe(5);
    const snapshot = replay(source.format("vt"), 25, 10).format("plain").replaceAll("\n", "");
    expect(count(snapshot, "vscode ➜")).toBe(1);
    expect(count(snapshot, "typed but not run")).toBe(1);
  });

  it("frees its handles once", () => {
    const disposable = terminal(10, 2);
    disposable.dispose();
    disposable.dispose();
    expect(() => disposable.write("x")).toThrow("disposed");
  });
});
