---
id: PRB.T-057
type: bug
parent: PRB.E-004
phase: 2
labels: [remote]
created: 2026-11-12
updated: 2026-11-12
---

# An older server runs on a database a newer build migrated

After an upgrade, starting an older installed version (`<install root>/versions/<old>/…`) on the same
state folder works: `runMigrations` in `apps/server/src/persistence/Migrations.ts` skips the
migration ids it does not know and logs only "migration history diverges from this build". The old
server then reads and writes a schema it was not built for. Only the service preflight
(`apps/server/src/cloud/servicePreflight.ts`) refuses this, and an installed target does not use it.
Found reading the code in PRB.T-032 (AC-12); not reproduced with two real builds, since no migration
landed between the builds installed so far.

## Direction

Refuse to start, before any write, when the database has migrations this build does not know, with a
message naming the newer version and what to do (start the newer version). Reuse the service
preflight's check rather than adding a second one.

## Done when

- A test at the migration layer: a database with an unknown later migration id makes startup fail
  with that message and leaves the database file unchanged.
- PRB.T-032 AC-12 can be checked by hand with two builds.
