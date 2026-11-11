import type { ShellSummary } from "@t3tools/contracts";

import type { PointerPage } from "../browser.ts";
import { expected } from "./expect.ts";
import type { ProjectResult } from "./setup.ts";
import type { ShellFollower } from "./shells.ts";
import { openWorkspacesMenu } from "./ui/workspacesMenu.ts";
import { waitFor } from "./waits.ts";

// Counts a scenario makes on a server other runs share: only over what it made or was handed.

type Projects = ReadonlyArray<Pick<ProjectResult, "path">>;

/** The shells in `list` started for one of `projects`. */
export const shellsOf = (list: ReadonlyArray<ShellSummary>, projects: Projects) => {
  const paths = new Set(projects.map(({ path }) => path));
  return list.filter((shell) => shell.project !== null && paths.has(shell.project));
};

/**
 * Waits until the server lists `count` shells for `projects` (running ones only with `running`),
 * judged from the current list on, and returns them.
 */
export async function shellCountOf(
  shells: ShellFollower,
  projects: Projects,
  count: number,
  { running = false }: { readonly running?: boolean } = {},
) {
  const mine = (list: ReadonlyArray<ShellSummary>) =>
    shellsOf(list, projects).filter((shell) => !running || shell.status === "running");
  const found = await shells.lists.until(
    `${count} ${running ? "running " : ""}shells in ${projects.map(({ path }) => path).join(", ")}`,
    (list) => mine(list).length === count,
    Math.max(0, shells.lists.mark() - 1),
  );
  return mine(found);
}

/** The tree's worktree nodes under the project `project`, never another project's. */
export const worktreeNodes = (page: PointerPage, project: string) =>
  page.locator(`[data-project="${project}"] [data-worktree]`);

/**
 * Opens the "Workspaces" menu's `submenu` and fails unless it offers every name in `includes` and
 * none in `excludes`; other runs' names are ignored. The excluded ones are judged once every
 * included one shows, so a list still loading cannot pass. The menu is closed afterwards.
 */
export async function expectMenuOffers(
  page: PointerPage,
  submenu: "Open workspace" | "Remove workspace",
  {
    includes,
    excludes = [],
  }: { readonly includes: ReadonlyArray<string>; readonly excludes?: ReadonlyArray<string> },
) {
  await openWorkspacesMenu(page, submenu);
  const menu = page.getByRole("menu").last();
  for (const name of includes) {
    await waitFor(
      menu.getByRole("menuitem", { name, exact: true }),
      `"${submenu}" to offer ${name}`,
    );
  }
  const offered = (await menu.getByRole("menuitem").allTextContents()).map((name) => name.trim());
  expected({
    what: `which of the scenario's names "${submenu}" offers`,
    expected: { includes, excludes: [] },
    found: {
      includes: includes.filter((name) => offered.includes(name)),
      excludes: excludes.filter((name) => offered.includes(name)),
    },
  });
  await closeWorkspacesMenu(page);
}

/** Closes the open "Workspaces" menu the way a user does: a click on an empty spot of the main pane. */
export async function closeWorkspacesMenu(page: PointerPage) {
  const size = page.viewportSize() ?? { width: 1200, height: 800 };
  await page.mouse.click(Math.round(size.width * 0.75), Math.round(size.height * 0.75));
  await waitFor(page.getByRole("menu").first(), "the Workspaces menu to close", {
    state: "detached",
  });
}
