import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { WorkspaceAddFolderInput, WorkspaceName, workspaceNameProblem } from "./workspace.ts";

const decodeNameExit = Schema.decodeUnknownExit(WorkspaceName);
const decodeName = Schema.decodeSync(WorkspaceName);
const decodes = (input: unknown) => Exit.isSuccess(decodeNameExit(input));
const decodeAddFolderExit = Schema.decodeUnknownExit(WorkspaceAddFolderInput);

describe("workspace contracts", () => {
  it.each([
    ["sparta", true],
    ["Sparta 2 (old)", true],
    ["  sparta  ", true],
    ["é workspace", true],
    ["x".repeat(64), true],
    ["", false],
    ["   ", false],
    ["x".repeat(65), false],
    ["a/b", false],
    ["a\\b", false],
    ["a:b", false],
    ["what?", false],
    ['say "hi"', false],
    ["a<b>", false],
    ["a|b", false],
    ["a*", false],
    ["tab\there", false],
    ["ends.", false],
    [".", false],
    ["..", false],
    ["con", false],
    ["LPT1", false],
    ["nul.txt", false],
    ["console", true],
  ])("accepts %j as a workspace name: %s", (name, valid) => {
    expect(decodes(name)).toBe(valid);
    expect(workspaceNameProblem(name) === null).toBe(valid);
  });

  it("trims the name it stores", () => {
    expect(decodeName("  sparta ")).toBe("sparta");
  });

  it.each([
    [{ mode: "import", name: "w", path: "/repo" }, true],
    [{ mode: "create", name: "w", parentPath: "/home", folderName: "app" }, true],
    [{ mode: "create", name: "w", parentPath: "/home", folderName: "a/b" }, false],
    [{ mode: "create", name: "w", parentPath: "/home", folderName: ".." }, false],
    [{ mode: "import", name: "w", path: "   " }, false],
    [{ mode: "create", name: "w", path: "/repo" }, false],
  ])("decodes add-folder input %j: %s", (input, valid) => {
    expect(Exit.isSuccess(decodeAddFolderExit(input))).toBe(valid);
  });
});
