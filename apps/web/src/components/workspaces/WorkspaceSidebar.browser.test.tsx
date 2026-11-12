import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import type { WorkspacesView } from "../../state/workspaces";
import { SidebarProvider } from "../ui/sidebar";
import { WorkspaceScreen } from "./WorkspaceScreen";
import { WorkspaceSidebar } from "./WorkspaceSidebar";

const mock = vi.hoisted(() => ({
  permission: "pending" as "pending" | "allowed" | "denied",
  /** Whether the shown workspace's one project is on disk; null shows no workspace. */
  projectExists: null as boolean | null,
}));

vi.mock("../../state/workspaces", () => ({
  useWorkspaces: (): Partial<WorkspacesView> => ({
    environmentId: null,
    workspaces: [{ name: "sparta" }] as WorkspacesView["workspaces"],
    listError: null,
    canChange: mock.permission === "allowed",
    canChangeKnown: mock.permission !== "pending",
    canStartShell: true,
    shown:
      mock.projectExists === null
        ? null
        : ({
            name: "sparta",
            projects: [
              { path: "/folders/plain", isGitRepository: false, exists: mock.projectExists },
            ],
            lastStarts: {},
            tabs: { shellIds: [], activeShellId: null },
          } as unknown as WorkspacesView["shown"]),
    startingScripts: async () => [],
    projectGit: async () => ({ error: "not a repository" }),
    activateShell: () => undefined,
    restoring: false,
    layoutError: null,
    tabs: { shellIds: [], activeShellId: null },
    restoreShown: () => undefined,
    refresh: async () => null,
    open: async () => null,
  }),
}));
vi.mock("../../state/shells", () => ({ useShells: () => ({ shells: [], error: null }) }));
vi.mock("../ShellView", () => ({ focusShell: () => undefined, ShellTerminal: () => null }));
vi.mock("../sidebar/SidebarChrome", () => ({
  SidebarChromeHeader: () => null,
  SidebarChromeFooter: () => null,
}));

const setup = (permission: typeof mock.permission, projectExists: boolean | null = null) => {
  mock.permission = permission;
  mock.projectExists = projectExists;
};

const sidebar = () => (
  <SidebarProvider defaultOpen>
    <WorkspaceSidebar />
  </SidebarProvider>
);

const createItem = () => page.getByRole("menuitem", { name: "Create workspace" });

describe("WorkspaceSidebar", () => {
  it("keeps an open submenu open when the write permission arrives", async () => {
    setup("pending");
    await using screen = await render(sidebar());

    await userEvent.click(page.getByRole("button", { name: "Workspaces" }));
    await userEvent.click(page.getByRole("menuitem", { name: "Open workspace" }));
    await expect.element(page.getByRole("menuitem", { name: "sparta" })).toBeVisible();

    mock.permission = "allowed";
    await screen.rerender(sidebar());

    await expect.element(page.getByRole("menuitem", { name: "sparta" })).toBeVisible();
    await expect.element(createItem()).not.toHaveAttribute("aria-disabled");
  });

  it("keeps the Create shell dialog open when its folder is found deleted meanwhile", async () => {
    setup("allowed", true);
    await using screen = await render(sidebar());

    await userEvent.click(page.getByRole("button", { name: "Create shell in plain" }));
    await expect.element(page.getByRole("heading", { name: "Create shell" })).toBeVisible();

    mock.projectExists = false;
    await screen.rerender(sidebar());

    await expect.element(page.getByText("moved")).toBeVisible();
    await expect.element(page.getByRole("heading", { name: "Create shell" })).toBeVisible();
  });

  it("offers no way to create a workspace without write permission", async () => {
    setup("denied");
    await using _screen = await render(sidebar());

    await userEvent.click(page.getByRole("button", { name: "Workspaces" }));
    await expect.element(page.getByRole("menuitem", { name: "Open workspace" })).toBeVisible();
    expect(createItem().query()).toBeNull();
  });
});

describe("WorkspaceScreen", () => {
  it("shows both start actions while the write permission is unknown", async () => {
    setup("pending");
    await using _screen = await render(
      <SidebarProvider defaultOpen>
        <WorkspaceScreen />
      </SidebarProvider>,
    );

    await expect.element(page.getByRole("button", { name: "Open workspace" })).toBeEnabled();
    await expect.element(page.getByRole("button", { name: "Create workspace" })).toBeDisabled();
  });
});
