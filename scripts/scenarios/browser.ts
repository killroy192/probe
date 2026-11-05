import { chromium, type Browser, type Page } from "playwright-core";

/** Scenarios drive the UI with the pointer; keyboard shortcuts are not available to them. */
export type PointerPage = Omit<Page, "keyboard">;

export async function launchBrowser(executablePath: string | undefined): Promise<Browser> {
  // Playwright's own signal handlers exit the process before the runner has stopped its servers.
  const common = {
    headless: true,
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  };
  try {
    return await chromium.launch(executablePath ? { ...common, executablePath } : common);
  } catch (error) {
    const what = executablePath ? `Browser at ${executablePath}` : "Playwright's Chromium";
    const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
    throw new Error(
      `${what} could not be started: ${reason}\nInstall it with: node scripts/node_modules/playwright-core/cli.js install --only-shell chromium (or pass --browser <path-to-executable>).`,
      { cause: error },
    );
  }
}

/**
 * Routes the page's server websockets through the harness so a scenario can cut them. Install it
 * before the page connects. `dropOn` closes every socket when the page next sends a frame that
 * contains `marker`, without passing that frame on, so the server never sees the request.
 */
export async function connectionCutter(page: PointerPage) {
  let marker: string | null = null;
  let dropped: (() => void) | null = null;
  let served = 0;
  const servedWaiters = new Set<() => void>();
  await page.routeWebSocket(/\/ws(\?|$)/, (socket) => {
    const server = socket.connectToServer();
    let first = true;
    server.onMessage((message) => {
      socket.send(message);
      if (!first) return;
      first = false;
      served++;
      for (const wake of servedWaiters) wake();
    });
    socket.onMessage((message) => {
      if (marker !== null && typeof message === "string" && message.includes(marker)) {
        marker = null;
        void socket.close({ code: 4000, reason: "dropped by the scenario" });
        void server.close();
        dropped?.();
        return;
      }
      server.send(message);
    });
  });
  return {
    /** Resolves once a frame containing `nextMarker` was dropped with its connection. */
    dropOn: (nextMarker: string) =>
      new Promise<void>((resolve) => {
        marker = nextMarker;
        dropped = resolve;
      }),
    /** How many connections the server has answered so far. */
    served: () => served,
    /** Resolves once the server has answered more than `count` connections. */
    servedMoreThan: (count: number) =>
      new Promise<void>((resolve) => {
        const check = () => {
          if (served <= count) return;
          servedWaiters.delete(check);
          resolve();
        };
        servedWaiters.add(check);
        check();
      }),
  };
}
