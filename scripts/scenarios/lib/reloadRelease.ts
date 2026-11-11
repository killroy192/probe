import * as Effect from "effect/Effect";

import type { PointerPage } from "../browser.ts";
import type { ServerHandle } from "../server.ts";
import type { Deadline } from "./deadlines.ts";
import { expected } from "./expect.ts";
import { layoutSaved } from "./navigate.ts";
import type { pageFrames } from "./network.ts";
import type { WorkspaceResult } from "./setup.ts";
import { followOutput, type ShellFollower, writeLine } from "./shells.ts";
import type { WsClient } from "./api.ts";
import { workspaceShown } from "./ui/tree.ts";

/**
 * When the held output is let go: after the reload began (the check), or before it and never,
 * which the self-tests use to prove the check fails.
 */
export type ReleaseTiming = "after-reload" | "before-reload" | "never";

/** A shell blocked on `read -r`, which prints `marker` once a line is written to it. */
export interface HeldOutput {
  readonly shellId: string;
  readonly marker: string;
}

/**
 * Makes the plain shell `shellId` wait on `read -r` and then print `marker`, a word of letters,
 * digits and dashes. The typed command spells the marker in two quoted halves, so only the
 * release prints it whole.
 */
export async function holdOutput(
  client: WsClient,
  shells: ShellFollower,
  shellId: string,
  marker: string,
): Promise<HeldOutput> {
  const half = Math.ceil(marker.length / 2);
  const spelled = `'${marker.slice(0, half)}''${marker.slice(half)}'`;
  await writeLine(client, shells, shellId, `read -r _ && echo ${spelled}`);
  return { shellId, marker };
}

const release = (client: WsClient, held: HeldOutput) =>
  Effect.runPromise(client["shell.write"]({ shellId: held.shellId, data: "\r" }));

/**
 * Reloads `page`, which shows `workspace`, with `held` let go at `timing`, then waits for the
 * held output on the page. It fails if the shell's raw output already holds the marker when the
 * reload has begun. Returns the frame offset the reload started from, for counting the output.
 */
export async function reloadReleasing(
  {
    page,
    server,
    client,
    frames,
    workspace,
  }: {
    readonly page: PointerPage;
    readonly server: Pick<ServerHandle, "rawOutput">;
    readonly client: WsClient;
    readonly frames: ReturnType<typeof pageFrames>;
    readonly workspace: WorkspaceResult;
  },
  held: HeldOutput,
  timing: ReleaseTiming,
  options: { readonly deadline?: Deadline } = {},
): Promise<number> {
  await layoutSaved(page, workspace.name);
  if (timing === "before-reload") {
    const { output, stop } = followOutput(client, held.shellId);
    try {
      const from = output.mark();
      await release(client, held);
      await output.until(
        `the held output ${held.marker} before the reload`,
        (event) => event.includes(held.marker),
        from,
      );
    } finally {
      await stop();
    }
  }
  const reloadedFrom = frames.mark();
  await page.reload({ waitUntil: "commit" });
  expected({
    what: `the held output of shell ${held.shellId} in its raw output once the reload began`,
    expected: "not printed yet",
    found: server.rawOutput(held.shellId).includes(held.marker) ? "printed" : "not printed yet",
  });
  if (timing === "after-reload") await release(client, held);
  await workspaceShown(page, workspace.name, " after the reload");
  await frames.until(
    `the held output ${held.marker} after the reload`,
    (frame) => frame.includes(held.marker),
    reloadedFrom,
    options,
  );
  return reloadedFrom;
}
