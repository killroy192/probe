import type { PointerPage } from "../browser.ts";
import type { ScenarioContext } from "../scenario.ts";
import { openTab, type ShownPage } from "./navigate.ts";
import { pageFrames } from "./network.ts";
import { type Setup, type SetupContext, world, type WorldResult, type WorldSpec } from "./setup.ts";
import { followOutput, writeLine } from "./shells.ts";

type FramedContext = SetupContext & Pick<ScenarioContext, "openPage">;

/** How many times `text` arrived in the recorded frames from offset `from` on. */
export const timesSeen = (frames: ReturnType<typeof pageFrames>, text: string, from: number) =>
  frames.seen.slice(from).reduce((sum, frame) => sum + frame.split(text).length - 1, 0);

/**
 * `world` with a page whose websocket frames are recorded from its first load, so a scenario can
 * count what the page received before and after a reload.
 */
export async function framedWorld(
  ctx: FramedContext,
  spec: Omit<WorldSpec, "page">,
): Promise<
  WorldResult & {
    readonly page: PointerPage;
    readonly frames: ReturnType<typeof pageFrames>;
    readonly shown: ShownPage;
  }
> {
  const page = await ctx.openPage();
  const frames = pageFrames(page);
  const made = await world({ ...ctx, openPage: async () => page }, { ...spec, page: true });
  return { ...made, page, frames, shown: { kind: "page", page, workspace: made.workspace } };
}

/** `framedWorld` with `count` plain shells in one folder, each with its tab opened from the tree. */
export async function plainTabs(ctx: FramedContext, count: number) {
  const made = await framedWorld(ctx, {
    projects: [{ kind: "folder", label: "plain" }],
    shells: [{ project: 0, count }],
  });
  for (const shell of made.shells) await openTab(made.page, shell);
  return made;
}

/** Writes `line` into the shell over the API and waits for its output to hold `printed`. */
export async function printedAfter(
  setup: Pick<Setup, "client" | "shells">,
  shellId: string,
  line: string,
  printed: string,
) {
  const { output, stop } = followOutput(setup.client, shellId);
  try {
    const from = output.mark();
    await writeLine(setup.client, setup.shells, shellId, line);
    await output.until(
      `shell ${shellId} to print ${printed}`,
      (event) => event.includes(printed),
      from,
    );
  } finally {
    await stop();
  }
}
