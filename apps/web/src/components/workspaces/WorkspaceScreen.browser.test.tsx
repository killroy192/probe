import { EnvironmentId, type ShellId, type ShellSummary } from "@t3tools/contracts";
import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import { ShellTabs } from "./WorkspaceScreen";

const shell = (shellId: string, title: string): ShellSummary => ({
  shellId,
  cwd: "/repo",
  status: "running",
  pid: 1,
  exitCode: null,
  exitSignal: null,
  label: "zsh",
  title,
  process: null,
  project: "/repo",
  worktree: null,
  branch: null,
  elsewhere: null,
  ended: null,
  missing: false,
  restored: false,
  promptReady: true,
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const mocks = vi.hoisted(() => ({ shells: [] as ShellSummary[] }));
vi.mock("../../state/shells", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../state/shells")>()),
  useShells: () => ({ shells: mocks.shells, error: null }),
}));
vi.mock("../ShellView", () => ({ ShellTerminal: () => null, focusShell: () => undefined }));

function Tabs({ onActivate }: { readonly onActivate: (shellId: ShellId) => void }) {
  const [tabs, setTabs] = useState({
    shellIds: ["one", "two"] as ReadonlyArray<ShellId>,
    activeShellId: "one" as ShellId | null,
  });
  return (
    <ShellTabs
      environmentId={EnvironmentId.make("env")}
      view={{
        tabs,
        activateShell: (shellId) => {
          onActivate(shellId);
          setTabs((current) => ({ ...current, activeShellId: shellId }));
        },
        closeTab: (shellId) =>
          setTabs((current) => ({
            shellIds: current.shellIds.filter((id) => id !== shellId),
            activeShellId: current.activeShellId,
          })),
      }}
    />
  );
}

const tab = (name: RegExp) => page.getByRole("tab", { name });

describe("ShellTabs", () => {
  it("selects a tab clicked outside its label and closes one without selecting it", async () => {
    mocks.shells = [shell("one", "Shell 1"), shell("two", "Shell 2")];
    const onActivate = vi.fn();
    await using _screen = await render(<Tabs onActivate={onActivate} />);

    const wrapper = tab(/Shell 2/)
      .element()
      .closest('[role="tablist"] > *');
    if (!(wrapper instanceof HTMLElement)) throw new Error("the tab has no wrapper");
    const { width, height } = wrapper.getBoundingClientRect();
    await userEvent.click(page.elementLocator(wrapper), {
      position: { x: width - 3, y: height - 4 },
    });
    await expect.element(tab(/Shell 2/)).toHaveAttribute("aria-selected", "true");

    onActivate.mockClear();
    await userEvent.hover(tab(/Shell 1/));
    await userEvent.click(page.getByRole("button", { name: /^Close Shell 1/ }));
    await expect.element(tab(/Shell 1/)).not.toBeInTheDocument();
    expect(onActivate).not.toHaveBeenCalled();
  });
});
