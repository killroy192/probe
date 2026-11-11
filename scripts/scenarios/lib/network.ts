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
