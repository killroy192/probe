import type { TerminalAttachStreamEvent } from "@t3tools/contracts";

const SIZE = /sz:(\d+) (\d+)\r?\n/;

/**
 * The `sz:<rows> <cols>` line a shell printed from offset `from` on, with the grid the server
 * last set before it: the PTY's size when the line was printed. Undefined until the line is in.
 */
export function gridAtSizeLine(events: ReadonlyArray<TerminalAttachStreamEvent>, from: number) {
  let text = "";
  for (let end = from; end < events.length; end++) {
    const event = events[end];
    if (event?.type !== "output") continue;
    text += event.data;
    const line = SIZE.exec(text);
    if (line === null) continue;
    const grid = events
      .slice(0, end)
      .findLast((seen) => seen.type === "activity" && seen.cols !== undefined);
    return {
      printedCols: Number(line[2]),
      gridCols: grid?.type === "activity" ? grid.cols : undefined,
    };
  }
  return undefined;
}
