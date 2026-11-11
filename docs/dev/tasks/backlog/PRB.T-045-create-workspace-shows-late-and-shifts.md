---
id: PRB.T-045
type: bug
parent: PRB.E-001
phase: 1
labels: []
created: 2026-11-11
updated: 2026-11-11
---

# Create workspace shows late and shifts the Workspaces menu under the pointer

## Symptom

Right after a page load, the sidebar's Workspaces menu and the start screen show no "Create
workspace" until the page learns its write permission. Then the item is inserted above "Open
workspace": a submenu opened in that window shuts and the highlight jumps to "Create workspace".
Found during PRB.E-005 verification (PRB.T-039 Follow-ups); original story PRB.T-003.

## Evidence

Quoted from PRB.T-039's verification notes:

- `S3.fork-remembered` (V3 rerun 1) and `E2-S4.exiting-command` (V3 full run 2), both the first
  scenario on a fresh shared server.
- Artifacts: `/tmp/probe-scenario-artifacts/2026-11-11T05-37-41-502Z-82729/S3.fork-remembered/` and
  `/tmp/probe-scenario-artifacts/2026-11-11T05-40-41-857Z-93488/E2-S4.exiting-command/`. The traces
  show the item missing at the click and present at the failure.
- The harness now waits for the item before it uses the menu (`openWorkspacesMenu` in
  `scripts/scenarios/lib/ui/workspacesMenu.ts`), so scenarios no longer see the defect.

## Expected

The menu does not move under the pointer: an item the user is pointing at or a submenu they opened
stays where it is once the menu is shown (`workspaces/FR-25`, pointer-only use). The start screen
offers both actions from the first frame it shows them (`workspaces/FR-1`), and the Workspaces menu
can create a workspace (`workspaces/FR-6`).

## Suspected cause

`canChange` comes from `workspaceEnvironment.create.permissionAtom` (`apps/web/src/state/workspaces.ts`)
and resolves after the workspace list. `WorkspaceSidebar` and `WorkspaceScreen` render the gated
items only once it does (`view.canChange ? … : null`), so the items below them move when it
arrives.

## Direction

- Pick how the menu behaves while the permission is unknown (for example, the item kept in place
  and disabled until the permission is known, or the menu not shown until then). That is a product
  call for the author; decide before coding.
- Keep the server authoritative: the item's availability still comes from the permission atom.

## Acceptance criteria

- With the permission still unknown, opening the Workspaces menu and a submenu, then letting the
  permission arrive, leaves the submenu open and the highlight where it was.
- The start screen does not shift its buttons when the permission arrives.
- A page without write permission still offers no way to create a workspace.

## How to verify

- A test that fails on `main`: render the sidebar menu with the permission pending, open "Open
  workspace", resolve the permission, and assert the submenu is still open.
- A scenario that opens the menu right after a load without waiting for "Create workspace" passes;
  the harness wait in `workspacesMenu.ts` can then go.
