import type { PointerPage } from "../browser.ts";
import { recorder } from "./waits.ts";

const recorded = new WeakMap<PointerPage, ReturnType<typeof recorder<string>>>();

/**
 * Text the page received over its websockets, which is what its canvas terminal draws. The runner
 * calls this on each new page before its first load, so every later call gets the same recorder
 * holding the frames from the start: Playwright reports no socket opened before `on("websocket")`.
 */
export function pageFrames(page: PointerPage) {
  const known = recorded.get(page);
  if (known !== undefined) return known;
  const frames = recorder<string>("page frames");
  recorded.set(page, frames);
  page.on("websocket", (socket) =>
    socket.on("framereceived", ({ payload }) => {
      if (typeof payload === "string") frames.push(payload);
    }),
  );
  return frames;
}

/** How many times `text` arrived in the recorded frames from offset `from` on. */
export const timesSeen = (frames: ReturnType<typeof pageFrames>, text: string, from: number) =>
  frames.seen.slice(from).reduce((sum, frame) => sum + frame.split(text).length - 1, 0);
