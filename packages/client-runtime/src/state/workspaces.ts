import { WS_METHODS } from "@t3tools/contracts";
import * as Stream from "effect/Stream";
import type { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { subscribe } from "../rpc/client.ts";
import { createEnvironmentRpcCommand, createEnvironmentSubscriptionAtomFamily } from "./runtime.ts";

/** Workspaces the environment has saved, one file each, and the operations on them. */
export function createWorkspaceEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    list: createEnvironmentSubscriptionAtomFamily(runtime, {
      label: "environment-data:workspace:list",
      subscribe: (_input: null) =>
        subscribe(WS_METHODS.subscribeWorkspaces, {}).pipe(Stream.map((event) => event.workspaces)),
    }),
    create: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:workspace:create",
      tag: WS_METHODS.workspaceCreate,
    }),
    remove: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:workspace:remove",
      tag: WS_METHODS.workspaceRemove,
    }),
    open: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:workspace:open",
      tag: WS_METHODS.workspaceOpen,
    }),
    addFolder: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:workspace:add-folder",
      tag: WS_METHODS.workspaceAddFolder,
    }),
    folderGit: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:workspace:folder-git",
      tag: WS_METHODS.workspaceFolderGit,
    }),
    startShell: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:workspace:start-shell",
      tag: WS_METHODS.workspaceStartShell,
    }),
  };
}
