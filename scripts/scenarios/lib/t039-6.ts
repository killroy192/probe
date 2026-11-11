import type { PointerPage } from "../browser.ts";
import { restartAndReload } from "./navigate.ts";
import type { Setup, SetupContext, WorkspaceResult } from "./setup.ts";

/**
 * `restartAndReload`, then waits for the new connection's first shell list, which is the server's
 * state after the restart. `lostHost` also ends the shell host while the server is down.
 */
export async function restartListed(
  ctx: SetupContext,
  page: PointerPage,
  ws: WorkspaceResult,
  previous: Setup,
  { lostHost = false }: { readonly lostHost?: boolean } = {},
): Promise<Setup> {
  const close = lostHost
    ? async () => {
        await previous.close();
        await ctx.server.stop();
        await ctx.server.stopShellHost();
      }
    : previous.close;
  const setup = await restartAndReload(ctx, page, ws, { close });
  await setup.shells.lists.until("the shell list after the restart", () => true, 0);
  return setup;
}
