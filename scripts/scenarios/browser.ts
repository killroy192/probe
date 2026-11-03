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
