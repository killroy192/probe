import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, type ShellId, ThreadId, shellOwnerId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { TYPOGRAPHY_ADVANCED_STORAGE_KEY } from "../appearanceFonts";
import { isElectron } from "../env";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { workspaceAreaProps } from "../lib/workspaceFocus";
import { primaryServerKeybindingsAtom } from "../state/server";
import { useShells } from "../state/shells";
import { TerminalViewport } from "./ThreadTerminalDrawer";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty";
import { SidebarInset } from "./ui/sidebar";
import { WorkspacePageHeader } from "./WorkspacePageHeader";

/** A standalone shell, addressed by its id, in the terminal surface the chat drawer uses. */
export function ShellView({
  environmentId,
  shellId,
}: {
  readonly environmentId: EnvironmentId;
  readonly shellId: ShellId;
}) {
  const contentArea = workspaceAreaProps("terminal", 1, "Shell");
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const [advancedTypography] = useLocalStorage(
    TYPOGRAPHY_ADVANCED_STORAGE_KEY,
    false,
    Schema.Boolean,
  );
  const { shells, error } = useShells(environmentId);
  const shell = shells?.find((candidate) => candidate.shellId === shellId) ?? null;
  const ownerId = ThreadId.make(shellOwnerId(shellId));

  return (
    <SidebarInset
      {...contentArea}
      role="main"
      className="h-dvh min-h-0 overflow-hidden overscroll-y-none"
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        {isElectron ? <WorkspacePageHeader electron /> : null}
        {shell ? (
          <div className="min-h-0 flex-1 p-2" data-testid="shell-view">
            <TerminalViewport
              advancedTypography={advancedTypography}
              threadRef={scopeThreadRef(environmentId, ownerId)}
              threadId={ownerId}
              terminalId={shellId}
              shellId={shellId}
              terminalLabel={shell.label}
              cwd={shell.cwd}
              onSessionExited={() => undefined}
              autoFocus
              visible
              keybindings={keybindings}
            />
          </div>
        ) : (
          <Empty className="flex-1">
            <EmptyHeader>
              <EmptyTitle>
                {shells === null && error === null ? "Loading shell" : "No shell"}
              </EmptyTitle>
              <EmptyDescription>
                {error ?? (shells === null ? null : `No shell with id ${shellId} is running here.`)}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </SidebarInset>
  );
}
