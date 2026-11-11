import * as Effect from "effect/Effect";

import type { PointerPage } from "../browser.ts";
import type { ServerHandle } from "../server.ts";
import type { Deadline } from "./deadlines.ts";
import { type CheckScenario, defineCheck } from "../scenario.ts";
import { expected } from "./expect.ts";
import { layoutSaved } from "./navigate.ts";
import { type pageFrames, timesSeen } from "./network.ts";
import { plainTabs, type WorkspaceResult } from "./setup.ts";
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

/**
 * A plain shell holds its output and lets it go at `release` while the page reloads; the page
 * must show it exactly once after the reload.
 */
export function outputDuringReload(
  url: string,
  spec: {
    readonly id: string;
    readonly title: string;
    readonly covers?: ReadonlyArray<string>;
    readonly release: ReleaseTiming;
    readonly deadline?: Deadline;
  },
): CheckScenario {
  const { release, deadline, ...named } = spec;
  return defineCheck(url, {
    ...named,
    needs: {},
    run: async (ctx) => {
      const { trail } = ctx;
      const { page, frames, workspace, shells, setup } = await trail.stage("setup", () =>
        plainTabs(ctx, 1),
      );
      const shell = shells[0]!;
      const held = await trail.stage("hold the output", () =>
        holdOutput(setup.client, setup.shells, shell.shellId, `during-${ctx.runId}-s4`),
      );
      const reloadedFrom = await trail.stage("reload while the output is held", () =>
        reloadReleasing(
          { page, server: ctx.server, client: setup.client, frames, workspace },
          held,
          release,
          deadline === undefined ? {} : { deadline },
        ),
      );
      await trail.stage("AC-4", async () => {
        expected({
          what: "times the output made during the reload reached the page after it",
          expected: 1,
          found: timesSeen(frames, held.marker, reloadedFrom),
        });
      });
    },
  });
}
