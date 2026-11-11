---
id: PRB.T-048
type: bug
parent: PRB.E-001
phase: 1
labels: [terminal-first]
created: 2026-11-11
updated: 2026-11-11
---

# Clicking a shell tab outside its label does not select it

Found in manual testing (2026-11-11). A shell tab in the tab strip selects only when the click lands
on its label text. A click on the rest of the tab (its padding, the gap beside the icon, the strip
under the text) does nothing, so selecting a tab feels like hitting a small target. The close "x"
also has almost no visible hover: it is a 16 px square, so its grey background barely shows, unlike
the hover actions on shell rows in the sidebar tree.

Cause: in `ShellTabs` (`apps/web/src/components/workspaces/WorkspaceScreen.tsx`) the tab is a plain
`div` that owns the padding and border and has no click handler. The `role="tab"` button inside it is
only as big as the label. The close button is `PanelTabCloseButton`
(`apps/web/src/components/ui/panel-tab-close-button.tsx`), a `size-4` raw button with `hover:bg-muted`.

Requirements it falls short of: `shells/FR-3` (clicking a tab shows its shell) and `workspaces/FR-25`
(every action works by pointer). Closing is `close-and-reopen/FR-1` to `FR-8`.

## Direction

- Split each tab into two hit areas: the close button, and a select area that covers the whole rest
  of the tab, padding included. Make the `role="tab"` button the select area (it takes the padding
  and fills the tab's height), rather than adding a second click handler to the wrapper, so there is
  one tab element for pointer, keyboard and screen readers. A click on the close button must not
  also select the tab.
- Give the close button a larger hit area and a visible grey hover background, matching the look of
  the sidebar shell-row hover actions (`SidebarHeaderIconButton`, `hover:bg-sidebar-row-hover`).
  Those use sidebar tokens, so do not reuse them in the tab strip: add or pick a variant on a
  `components/ui` component, never restyle with `className` (AGENTS.md, Taste).
- `PanelTabCloseButton` is also used by `ThreadTerminalDrawer.tsx` and `RightPanelTabs.tsx`. Change
  it for all of them, or give the shell tab strip its own variant; say which in the PR.
- Keep what the scenario harness finds by (`scripts/scenarios/lib/ui/tabs.ts`): `role="tab"`,
  `data-shell-id`, `aria-selected`, and the close button's `Close <name>` accessible name. Its
  `closeTab` hovers the tab wrapper first; check it still works.
- Proof: a browser test of `ShellTabs` that clicks the tab's padding (outside the label) and asserts
  the tab is selected, and that clicking the close button closes without selecting. The hover look
  is visual: before/after captures, no test.

## Done when

- A click anywhere on a tab except its close button selects that tab and shows its shell.
- Clicking the close button closes the tab and does not select it first.
- Hovering the close button shows a grey background as clear as the sidebar row actions.
- The scenarios that select and close tabs pass unchanged.
