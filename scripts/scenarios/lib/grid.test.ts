import type { TerminalAttachStreamEvent } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { gridAtSizeLine } from "./grid.ts";

const base = { threadId: "shell:1", terminalId: "term-1" };
let sequence = 0;
const grid = (cols: number): TerminalAttachStreamEvent => ({
  ...base,
  sequence: ++sequence,
  type: "activity",
  hasRunningSubprocess: false,
  label: "zsh",
  cols,
  rows: 30,
});
const output = (data: string): TerminalAttachStreamEvent => ({
  ...base,
  sequence: ++sequence,
  type: "output",
  data,
});

describe("gridAtSizeLine", () => {
  it("takes the grid set before the size line, when the first fit lands after the shrink began", () => {
    const events = [
      grid(115),
      grid(77),
      output("echo sz:$(stty size)\r\n"),
      output("sz:30 7"),
      output("7\r\n"),
    ];
    expect(gridAtSizeLine(events, 2)).toEqual({ printedCols: 77, gridCols: 77 });
  });

  it("ignores a grid set after the size line was printed", () => {
    const events = [grid(115), output("sz:30 115\r\n"), grid(77)];
    expect(gridAtSizeLine(events, 1)).toEqual({ printedCols: 115, gridCols: 115 });
  });

  it("is undefined until the whole line is in", () => {
    expect(gridAtSizeLine([grid(77), output("sz:30 7")], 1)).toBeUndefined();
  });
});
