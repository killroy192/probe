---
id: PRB.T-014
type: bug
parent:
phase: 9
labels: [mobile-impact, terminal-first]
created: 2026-11-08
updated: 2026-11-08
---

# Mobile terminal shows repeated prompt after a resize and remount

Split from PRB.T-010, which fixed this on web. Not reproduced on a device yet; expected from the
code.

A client keeps a terminal's attach stream for 5 minutes after its last viewer unmounts, so a
screen that mounts again replays the client buffer: the last server snapshot plus every redraw
since. When the grid changed after that snapshot, the redraws printed at other widths replay as
copies of the prompt and typed text. On web, a debug run showed 5 copies after a resize and a
navigation away and back.

Web fix to mirror: the buffer marks the change (`needsFreshSnapshot` in
`packages/client-runtime/src/state/terminalSession.ts`), and a viewport that mounts with the mark
refreshes its session atom instead of writing the buffer, which restarts the attach stream and
gets a new snapshot (`apps/web/src/state/terminalSessions.ts`, `ThreadTerminalDrawer.tsx`).

On mobile, `ThreadTerminalRouteScreen.tsx` reads the attach atom through
`use-terminal-session.ts`, and `NativeTerminalSurface.tsx` writes `props.output` once the native
view is ready (`terminalOutputWriter.ts`). The screen has to refresh the attach (or observe) atom
on mount and keep the native view from writing the stale buffer before the new snapshot lands.

## Done when

- On iOS and Android, typed text left at the prompt shows once after a resize, leaving the
  terminal screen and coming back.
- A test fails before the fix, at the lowest layer that shows it.
