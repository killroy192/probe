import { EnvironmentId, type FilesystemBrowseResult } from "@t3tools/contracts";
import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { AddProjectDialog } from "./AddProjectDialog";

// The server's home folder as it is on disk now; a listing is cached until it is refreshed.
const disk = vi.hoisted(() => ({ folders: [] as string[] }));
const listHome = (): FilesystemBrowseResult => ({
  parentPath: "/home/dev",
  entries: disk.folders.map((name) => ({ name, fullPath: `/home/dev/${name}` })),
});

vi.mock(import("../../state/query"), async (original) => ({
  ...(await original()),
  useEnvironmentQuery: (() => {
    const [data, setData] = useState(listHome);
    return {
      data,
      dataUpdatedAt: 1,
      error: null,
      failure: null,
      isPending: false,
      isSuccess: true,
      refresh: () => setData(listHome()),
    };
  }) as never,
}));
vi.mock(import("../../state/filesystem"), async (original) => ({
  ...(await original()),
  useFilesystemReadAccess: (() => ({ canReadFiles: true })) as never,
  filesystemEnvironment: { browse: () => null } as never,
}));
vi.mock(import("../../state/environments"), async (original) => ({
  ...(await original()),
  useEnvironments: (() => ({ environments: [] })) as never,
}));

function setup() {
  disk.folders = ["alpha", "gone"];
}

const folderField = () => page.getByRole("combobox");
const folderList = () => page.getByRole("listbox", { name: "Folders on the server" });

describe("AddProjectDialog", () => {
  it("lists the folder again each time the folder list opens", async () => {
    setup();
    await using _screen = await render(
      <AddProjectDialog
        open
        onOpenChange={() => undefined}
        environmentId={EnvironmentId.make("env")}
        workspaceName="sparta"
        onAddProject={async () => ({ error: "unused" })}
      />,
    );

    await userEvent.click(folderField());
    await expect.element(folderList().getByRole("option", { name: "gone" })).toBeVisible();

    await userEvent.keyboard("{Escape}");
    await expect.element(folderList()).not.toBeInTheDocument();
    disk.folders = ["alpha"];

    await userEvent.click(folderField());
    await expect.element(folderList().getByRole("option", { name: "alpha" })).toBeVisible();
    await expect
      .element(folderList().getByRole("option", { name: "gone" }))
      .not.toBeInTheDocument();
  });
});
