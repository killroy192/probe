import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { AddProjectDialog } from "./AddProjectDialog";

// The server's folders as they are on disk now, by listed folder. Each folder's listing is a
// kept-alive atom, so it stays cached until something refreshes it.
const disk = vi.hoisted(() => ({
  folders: new Map<string, ReadonlyArray<string>>(),
  listings: new Map<string, unknown>(),
}));

vi.mock(import("../../state/filesystem"), async (original) => {
  const { Atom, AsyncResult } = await import("effect/reactivity");
  const browse = ({ input }: { readonly input: { readonly partialPath: string } }) => {
    const folder = input.partialPath === "~/" ? "/home/dev" : input.partialPath.replace(/\/$/, "");
    let listing = disk.listings.get(folder);
    if (listing === undefined) {
      listing = Atom.make(() =>
        AsyncResult.success({
          parentPath: folder,
          entries: (disk.folders.get(folder) ?? []).map((name) => ({
            name,
            fullPath: `${folder}/${name}`,
          })),
        }),
      ).pipe(Atom.keepAlive);
      disk.listings.set(folder, listing);
    }
    return listing;
  };
  return {
    ...(await original()),
    useFilesystemReadAccess: (() => ({ canReadFiles: true })) as never,
    filesystemEnvironment: { browse } as never,
  };
});
vi.mock(import("../../state/environments"), async (original) => ({
  ...(await original()),
  useEnvironments: (() => ({ environments: [] })) as never,
}));

function setup() {
  disk.listings.clear();
  disk.folders.clear();
  disk.folders.set("/home/dev", ["alpha", "gone"]);
  disk.folders.set("/home/dev/alpha", ["one", "two"]);
}

const renderDialog = () =>
  render(
    <AddProjectDialog
      open
      onOpenChange={() => undefined}
      environmentId={EnvironmentId.make("env")}
      workspaceName="sparta"
      onAddProject={async () => ({ error: "unused" })}
    />,
  );

const folderField = () => page.getByRole("combobox");
const folderList = () => page.getByRole("listbox", { name: "Folders on the server" });
const folder = (name: string) => folderList().getByRole("option", { name, exact: true });

describe("AddProjectDialog", () => {
  it("lists the folder again each time the folder list opens", async () => {
    setup();
    await using _screen = await renderDialog();

    await userEvent.click(folderField());
    await expect.element(folder("gone")).toBeVisible();

    await userEvent.keyboard("{Escape}");
    await expect.element(folderList()).not.toBeInTheDocument();
    disk.folders.set("/home/dev", ["alpha"]);

    await userEvent.click(folderField());
    await expect.element(folder("alpha")).toBeVisible();
    await expect.element(folder("gone")).not.toBeInTheDocument();
  });

  it("lists a folder again when the open list walks back into it", async () => {
    setup();
    await using _screen = await renderDialog();

    await userEvent.click(folderField());
    await userEvent.click(folder("alpha"));
    await expect.element(folder("two")).toBeVisible();
    await userEvent.click(folder(".."));
    await expect.element(folder("gone")).toBeVisible();
    disk.folders.set("/home/dev/alpha", ["one"]);

    await userEvent.click(folder("alpha"));
    await expect.element(folder("one")).toBeVisible();
    await expect.element(folder("two")).not.toBeInTheDocument();
  });
});
