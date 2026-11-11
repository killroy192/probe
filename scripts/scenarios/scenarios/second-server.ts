// @effect-diagnostics nodeBuiltinImport:off - Reads the two throwaway homes directly.

import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { withClient } from "../lib/api.ts";
import { runtimePid } from "../lib/files.ts";
import { saveServerInBrowser } from "../lib/seam.ts";
import { projectPaths, type Setup, setupOn, workspaceNames } from "../lib/setup.ts";
import { openShell } from "../lib/shells.ts";
import { check, recorder, waitFor } from "../lib/waits.ts";
import type { Scenario } from "../scenario.ts";
import { REPO_ROOT } from "../server.ts";

const LABEL = "Second server";

const isInside = (child: string, parent: string) => {
  const relative = NodePath.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !NodePath.isAbsolute(relative));
};

export const secondServer: Scenario = {
  id: "R1",
  title: "second server",
  needs: { secondServer: true },
  run: async (ctx) => {
    const { server, trail } = ctx;
    const second = await ctx.startSecondServer();
    const [home1, home2] = await Promise.all([
      NodeFSP.realpath(server.home),
      NodeFSP.realpath(second.home),
    ]);

    // AC-1: two processes, two origins, two homes, neither inside the other or the UI's checkout.
    await trail.stage("AC-1", async () => {
      check(second.origin !== server.origin, "Both servers answer on the same origin.");
      check(
        (await runtimePid(server)) === server.pid() && (await runtimePid(second)) === second.pid(),
        "A server's home holds another process's runtime file.",
      );
      for (const [child, parent] of [
        [home2, home1],
        [home1, home2],
        [home2, REPO_ROOT],
      ] as const) {
        check(!isInside(child, parent), `${child} is inside ${parent}.`);
      }
    });

    // Each server's bearer token is minted once: setup and the seam below share it.
    const onFirstSetup = await setupOn(ctx);
    const onSecondSetup = await setupOn({ ...ctx, server: second });

    // AC-2 and EC-4: seed both servers, one name on both, each with a project in its own home.
    await trail.stage("AC-2", async () => {
      for (const [setup, name] of [
        [onSecondSetup, "alpha"],
        [onSecondSetup, "shared"],
        [onFirstSetup, "shared"],
      ] as const) {
        const ws = await setup.workspace(name, { exact: true });
        await setup.project(ws, await setup.folder(`${name}-project`));
      }
      const onSecond = await Effect.runPromise(workspaceNames(onSecondSetup.client));
      const onFirst = await Effect.runPromise(workspaceNames(onFirstSetup.client));
      check(
        JSON.stringify(onSecond) === JSON.stringify(["alpha", "shared"]),
        `The second server lists ${JSON.stringify(onSecond)}, not its seeded workspaces.`,
      );
      check(
        JSON.stringify(onFirst) === JSON.stringify(["shared"]),
        `The default server lists ${JSON.stringify(onFirst)}; it must hold none of the second server's.`,
      );
      const sharedOn = async (setup: Setup) =>
        Promise.all(
          (await Effect.runPromise(projectPaths(setup.client, "shared"))).map((path) =>
            NodeFSP.realpath(path),
          ),
        );
      const [shared1, shared2] = await Promise.all([
        sharedOn(onFirstSetup),
        sharedOn(onSecondSetup),
      ]);
      check(
        shared1.every((path) => isInside(path, home1)) &&
          shared2.every((path) => isInside(path, home2)),
        "A same-named workspace points at the other server's project.",
      );
    });

    // A shell on the second server is ready on that server's own list only.
    await trail.stage("a shell on the second server", async () => {
      const opened = await openShell(onSecondSetup.client, home2);
      await onSecondSetup.shells.lists.until(
        `shell ${opened.shellId} ready on the second server`,
        (list) => list.some((shell) => shell.shellId === opened.shellId && shell.promptReady),
        0,
      );
      const firstList = await Effect.runPromise(
        onFirstSetup.client.subscribeShells({}).pipe(Stream.runHead),
      );
      check(
        Option.isSome(firstList) &&
          firstList.value.type === "snapshot" &&
          !firstList.value.shells.some((shell) => shell.shellId === opened.shellId),
        "The default server lists a shell the second server runs.",
      );
      await Effect.runPromise(onSecondSetup.client["shell.kill"]({ shellId: opened.shellId }));
    });

    // AC-3: the seam saves the second server in the browser, and the UI connects to it.
    await trail.stage("AC-3", async () => {
      const page = await ctx.openPage();
      const secondPort = new URL(second.origin).port;
      const answered = recorder<string>("second server sockets");
      // EC-1: every credential the page sends to the default server, checked below.
      const sentToFirst: Array<string> = [];
      page.on("request", (request) => {
        const authorization = request.headers()["authorization"];
        if (new URL(request.url()).origin === server.origin && authorization) {
          sentToFirst.push(authorization);
        }
      });
      page.on("websocket", (socket) => {
        if (new URL(socket.url()).port !== secondPort) return;
        socket.once("framereceived", () => answered.push(socket.url()));
      });
      const saved = await saveServerInBrowser(page, second, LABEL);
      // Pushed only by sockets to the second server, which the page opens after the seam saves it.
      await answered.until("the UI to connect to the second server", () => true, 0);
      const heldList = await withClient(second, workspaceNames, {
        bearerToken: saved.bearerToken,
      });
      check(
        JSON.stringify(heldList) === JSON.stringify(["alpha", "shared"]),
        `With the credential the UI holds, the second server lists ${JSON.stringify(heldList)}.`,
      );

      await page.goto(`${server.origin}/settings/connections`);
      await waitFor(
        page.getByText(LABEL, { exact: true }).first(),
        "the second server in the connections list",
      );
      check(
        !sentToFirst.some((authorization) => authorization.includes(saved.bearerToken)),
        "The second server's credential was sent to the default server.",
      );
    });
  },
};
