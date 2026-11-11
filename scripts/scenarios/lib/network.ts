import type { PointerPage } from "../browser.ts";
import { recorder } from "./waits.ts";

/** Text the page received over its websockets, which is what its canvas terminal draws. */
export function pageFrames(page: PointerPage) {
  const frames = recorder<string>("page frames");
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
