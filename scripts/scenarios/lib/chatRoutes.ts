import type { PointerPage } from "../browser.ts";
import { expected } from "./expect.ts";
import { recorder } from "./waits.ts";

/** The paths the terminal-first app opens on its own: the workspace screen and the pairing page. */
const NOT_CHAT = new Set(["/", "/pair"]);

/** Whether the app path `path` is a chat route, that is, any path but the app's own. */
export const isChatRoute = (path: string) => !NOT_CHAT.has(path);

/**
 * Records the path of every main-frame navigation of `page` from now on. Install it before the
 * flow it guards, then call `expectNoChatRoute` once the flow is done.
 */
export function watchRoutes(page: PointerPage) {
  const paths = recorder<string>("page paths");
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) paths.push(new URL(frame.url()).pathname);
  });
  return {
    paths,
    /** Fails naming every chat route the page opened since the watch began. */
    expectNoChatRoute: (flow: string) =>
      expected({
        what: `chat routes the page opened during ${flow}`,
        expected: [],
        found: paths.seen.filter(isChatRoute),
      }),
  };
}

export type RouteWatch = ReturnType<typeof watchRoutes>;
