---
id: PRB.T-049
type: bug
parent: PRB.E-001
phase: 1
labels: [terminal-first]
created: 2026-11-11
updated: 2026-11-11
---

# Cursor lands one column left in open background tabs after a resize and reload

## Goal

After a resize and a reload, shells whose tab was open but not selected drew the cursor on the last
printed character instead of after it. Every open tab now draws its cursor where the shell put it,
the first time it is shown.

## Delivered

- A hidden tab's terminal had no size, so it was built at 1x1 and the server's reattach snapshot was
  replayed there; its cursor move clamped to the last printed cell and stayed there when the text
  reflowed on show. An unsized terminal now takes the server's grid, the one the snapshot is encoded
  for, and narrows to its own fit when shown.
- Proof: `surface.test.ts` "places the cursor of a snapshot replayed while hidden where the shell put
  it once shown" failed before the fix (`[8, 1]` instead of `[10, 1]`) and passes after. The user
  confirmed the fix by hand on a dev server (2026-11-11). Merged 2026-11-11.
- Desktop uses the same surface; mobile is not affected.

## Decisions

- 2026-11-11: no scenario check. Scenarios cannot read the drawn cursor, and adding a page readout
  only for tests was not worth it; the surface test is the lowest layer that fails on `main`.
