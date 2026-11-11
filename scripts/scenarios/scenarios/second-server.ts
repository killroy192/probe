// @effect-diagnostics nodeBuiltinImport:off - Reads and seeds the two throwaway homes directly.

import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { withClient, connectRpc, type WsClient } from "../lib/api.ts";
import { issueBearerToken, saveServerInBrowser } from "../lib/seam.ts";
import { seedWorkspace } from "../lib/setup.ts";
import { shellList } from "../lib/shells.ts";
import { check, recorder } from "../lib/waits.ts";
import type { Scenario } from "../scenario.ts";
import { REPO_ROOT, type ServerHandle } from "../server.ts";

const LABEL = "Second server";

const isInside = (child: string, parent: string) => {
  const relative = NodePath.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !NodePath.isAbsolute(relative));
};

async function runtimePid(server: ServerHandle): Promise<number> {
  const file = NodePath.join(server.home, "userdata", "server-runtime.json");
  return (JSON.parse(await NodeFSP.readFile(file, "utf8")) as { readonly pid: number }).pid;
}

const listNames = (client: WsClient) =>
  client["subscribeWorkspaces"]({}).pipe(
    Stream.runHead,
    Effect.map((first) =>
      Option.match(first, {
        onNone: () => [],
        onSome: ({ workspaces }) => workspaces.map(({ name }) => name).toSorted(),
      }),
    ),
  );

const projectPaths = (client: WsClient, name: string) =>
  client["workspace.open"]({ name }).pipe(
    Effect.map((detail) => detail.projects.map(({ path }) => path)),
  );

export const secondServer: Scenario = {
  id: "R1",
  title: "second server",
  needs: { secondServer: true },
  run: async ({ server, openPage, startSecondServer }) => {
    const second = await startSecondServer();

    // AC-1: two processes, two origins, two homes, neither inside the other or the UI's checkout.
    check(second.origin !== server.origin, "Both servers answer on the same origin.");
    check(
      (await runtimePid(server)) === server.pid() && (await runtimePid(second)) === second.pid(),
      "A server's home holds another process's runtime file.",
    );
    const [home1, home2] = await Promise.all([
      NodeFSP.realpath(server.home),
      NodeFSP.realpath(second.home),
    ]);
    for (const [child, parent] of [
      [home2, home1],
      [home1, home2],
      [home2, REPO_ROOT],
    ] as const) {
      check(!isInside(child, parent), `${child} is inside ${parent}.`);
    }

    // AC-2 and EC-4: seed both servers, one name on both, each with a project in its own home.
    const token1 = await issueBearerToken(server);
    const token2 = await issueBearerToken(second);
    await withClient(second.origin, token2, (client) =>
      Effect.all([seedWorkspace(client, home2, "alpha"), seedWorkspace(client, home2, "shared")]),
    );
    await withClient(server.origin, token1, (client) => seedWorkspace(client, home1, "shared"));
    const onSecond = await withClient(second.origin, token2, listNames);
    const onFirst = await withClient(server.origin, token1, listNames);
    check(
      JSON.stringify(onSecond) === JSON.stringify(["alpha", "shared"]),
      `The second server lists ${JSON.stringify(onSecond)}, not its seeded workspaces.`,
    );
    check(
      JSON.stringify(onFirst) === JSON.stringify(["shared"]),
      `The default server lists ${JSON.stringify(onFirst)}; it must hold none of the second server's.`,
    );
    const sharedOn = async (origin: string, token: string) =>
      withClient(origin, token, (client) => projectPaths(client, "shared"));
    const [shared1, shared2] = await Promise.all([
      sharedOn(server.origin, token1),
      sharedOn(second.origin, token2),
    ]);
    check(
      shared1.every((path) => isInside(path, home1)) &&
        shared2.every((path) => isInside(path, home2)),
      "A same-named workspace points at the other server's project.",
    );

    // A shell on the second server is ready on that server's own list only.
    const direct = await connectRpc(second.origin, { bearerToken: token2 });
    try {
      const secondShells = shellList(direct.client);
      const opened = await Effect.runPromise(direct.client["shell.open"]({ cwd: home2 }));
      await secondShells.lists.until(
        `shell ${opened.shellId} ready on the second server`,
        (list) => list.some((shell) => shell.shellId === opened.shellId && shell.promptReady),
        0,
      );
      const firstList = await withClient(server.origin, token1, (client) =>
        client.subscribeShells({}).pipe(Stream.runHead),
      );
      check(
        Option.isSome(firstList) &&
          firstList.value.type === "snapshot" &&
          !firstList.value.shells.some((shell) => shell.shellId === opened.shellId),
        "The default server lists a shell the second server runs.",
      );
      await Effect.runPromise(direct.client["shell.kill"]({ shellId: opened.shellId }));
    } finally {
      await direct.close();
    }

    // AC-3: the seam saves the second server in the browser, and the UI connects to it.
    const page = await openPage();
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
    const heldList = await withClient(second.origin, saved.bearerToken, listNames);
    check(
      JSON.stringify(heldList) === JSON.stringify(["alpha", "shared"]),
      `With the credential the UI holds, the second server lists ${JSON.stringify(heldList)}.`,
    );

    await page.goto(`${server.origin}/settings/connections`);
    await page.getByText(LABEL, { exact: true }).first().waitFor();
    check(
      !sentToFirst.some((authorization) => authorization.includes(saved.bearerToken)),
      "The second server's credential was sent to the default server.",
    );
  },
};
