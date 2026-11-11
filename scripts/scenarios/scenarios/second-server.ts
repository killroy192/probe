// @effect-diagnostics nodeBuiltinImport:off - Reads the two throwaway homes directly.

import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { withClient } from "../lib/api.ts";
import { expected } from "../lib/expect.ts";
import { runtimePid } from "../lib/files.ts";
import { saveServerInBrowser } from "../lib/seam.ts";
import { projectPaths, type Setup, setupOn, workspaceNames } from "../lib/setup.ts";
import { openShell } from "../lib/shells.ts";
import { recorder, waitFor } from "../lib/waits.ts";
import { defineCheck } from "../scenario.ts";
import { REPO_ROOT } from "../server.ts";

const LABEL = "Second server";

const isInside = (child: string, parent: string) => {
  const relative = NodePath.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !NodePath.isAbsolute(relative));
};

export const twoServers = defineCheck(import.meta.url, {
  id: "R1.two-servers",
  title:
    "a second server runs apart from the default one, with its own home, workspaces and shells",
  needs: { secondServer: true },
  // One second server answers all of them: its process and home, its workspaces, and its shells.
  verifies: [
    "second-server/FR-1",
    "second-server/FR-2",
    "second-server/FR-3",
    "second-server/FR-4",
    "second-server/FR-5",
  ],
  run: async (ctx) => {
    const { server, trail, runId } = ctx;
    const second = await ctx.startSecondServer();
    const [home1, home2] = await Promise.all([
      NodeFSP.realpath(server.home),
      NodeFSP.realpath(second.home),
    ]);

    await trail.stage("separate processes and homes", async () => {
      expected({
        what: "both servers on one origin",
        expected: false,
        found: second.origin === server.origin,
      });
      expected({
        what: "the pid in the default server's runtime file",
        expected: server.pid(),
        found: await runtimePid(server),
      });
      expected({
        what: "the pid in the second server's runtime file",
        expected: second.pid(),
        found: await runtimePid(second),
      });
      for (const [child, parent] of [
        [home2, home1],
        [home1, home2],
        [home2, REPO_ROOT],
      ] as const) {
        expected({
          what: `${child} inside ${parent}`,
          expected: false,
          found: isInside(child, parent),
        });
      }
    });

    const onFirstSetup = await setupOn(ctx);
    const onSecondSetup = await setupOn({ ...ctx, server: second });
    const alpha = `alpha-${runId}`;
    const shared = `shared-${runId}`;

    // One name on both servers, each with a project in its own home.
    await trail.stage("separate workspaces", async () => {
      for (const [setup, name] of [
        [onSecondSetup, alpha],
        [onSecondSetup, shared],
        [onFirstSetup, shared],
      ] as const) {
        const ws = await setup.workspace(name, { exact: true });
        await setup.project(ws, await setup.folder(`${name}-project`));
      }
      expected({
        what: "the second server's workspaces",
        expected: [alpha, shared],
        found: await Effect.runPromise(workspaceNames(onSecondSetup.client)),
      });
      const onFirst = await Effect.runPromise(workspaceNames(onFirstSetup.client));
      expected({
        what: "this run's workspaces on the default server",
        expected: [shared],
        found: onFirst.filter((name) => name === alpha || name === shared),
      });
      const sharedOn = async (setup: Setup) =>
        Promise.all(
          (await Effect.runPromise(projectPaths(setup.client, shared))).map((path) =>
            NodeFSP.realpath(path),
          ),
        );
      const [shared1, shared2] = await Promise.all([
        sharedOn(onFirstSetup),
        sharedOn(onSecondSetup),
      ]);
      expected({
        what: `the default server's ${shared} projects outside its home`,
        expected: [],
        found: shared1.filter((path) => !isInside(path, home1)),
      });
      expected({
        what: `the second server's ${shared} projects outside its home`,
        expected: [],
        found: shared2.filter((path) => !isInside(path, home2)),
      });
    });

    await trail.stage("a shell on the second server", async () => {
      const opened = await openShell(onSecondSetup.client, home2);
      await onSecondSetup.shells.lists.until(
        `shell ${opened.shellId} ready on the second server's list`,
        (list) => list.some((shell) => shell.shellId === opened.shellId && shell.promptReady),
        0,
      );
      const firstList = await Effect.runPromise(
        onFirstSetup.client.subscribeShells({}).pipe(Stream.runHead),
      );
      expected({
        what: `shell ${opened.shellId} in the default server's snapshot`,
        expected: "absent",
        found: Option.match(firstList, {
          onNone: () => "no snapshot",
          onSome: (first) =>
            first.type !== "snapshot"
              ? `a ${first.type} event`
              : first.shells.some((shell) => shell.shellId === opened.shellId)
                ? "present"
                : "absent",
        }),
      });
    });
  },
});

export const seam = defineCheck(import.meta.url, {
  id: "R1.seam",
  title: "the browser connects to a saved second server without sending its credential elsewhere",
  needs: { secondServer: true },
  // The seam save is one action: the UI connecting, the label listed, where the credential went.
  verifies: ["second-server/FR-6", "second-server/FR-7", "second-server/FR-8"],
  run: async (ctx) => {
    const { server, trail } = ctx;
    const second = await ctx.startSecondServer();
    const onSecondSetup = await setupOn({ ...ctx, server: second });
    const ws = await onSecondSetup.workspace("seam");

    await trail.stage("connect to the saved server", async () => {
      const page = await ctx.openPage();
      const secondPort = new URL(second.origin).port;
      const answered = recorder<string>("second server sockets");
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
      expected({
        what: "the second server's workspaces, listed with the credential the UI holds",
        expected: [ws.name],
        found: await withClient(second, workspaceNames, { bearerToken: saved.bearerToken }),
      });

      await page.goto(`${server.origin}/settings/connections`);
      await waitFor(
        page.getByText(LABEL, { exact: true }).first(),
        "the second server in the connections list",
      );
      // Judged once the connections list shows the second server.
      expected({
        what: "requests to the default server carrying the second server's credential",
        expected: 0,
        found: sentToFirst.filter((authorization) => authorization.includes(saved.bearerToken))
          .length,
      });
    });
  },
});

export const successors = [twoServers, seam];
