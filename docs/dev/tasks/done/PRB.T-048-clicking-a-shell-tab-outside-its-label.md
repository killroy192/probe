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

## Goal

A shell tab selected only when the click hit its label text, and its close "x" had almost no
visible hover. A click anywhere on a tab except the "x" now selects it, and the "x" is a larger
target with a clear hover.

## Delivered

- The `role="tab"` button covers the whole tab, padding included; the close button sits over the
  tab's left padding outside it, so closing never selects. Keyboard focus reaches the tab before its
  close button.
- `PanelTabCloseButton` has a `size="lg"` variant (24 px, accent hover) used by the shell tab strip
  only; the frozen chat-era drawers keep the default.
- Proof: `WorkspaceScreen.browser.test.tsx` "ShellTabs > selects a tab clicked outside its label and
  closes one without selecting it" (failed before: `aria-selected="false"`). The full scenario check
  suite passed on the branch (104/104), so the harness still finds and closes tabs. Merged
  2026-11-11.
