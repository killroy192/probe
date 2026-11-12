---
id: PRB.T-057
type: bug
parent: PRB.E-004
phase: 2
labels: [remote, verify]
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

## Verification notes

- Fix in `da191e870`: `assertNoNewerMigrations` (`apps/server/src/persistence/Migrations.ts`) runs
  first in the startup layer (`Sqlite.ts`, before its pragmas) and in `runMigrations`; the service
  preflight shares `newerMigrations`. The message names the unknown migration ids, not the newer
  version: the database does not record which version wrote them.
- Test: `runMigrations > refuses a database a newer build migrated before writing to it`
  (`Migrations.test.ts`) fails on `main` (startup succeeded) and passes with the fix; the database
  is out of WAL so a header rewrite by startup's pragmas would also fail it.
- `serve --base-dir <tmp>` on a doctored database with `74_FromNewerProbe`: exits 1 with the
  message, the database's sha256 is unchanged and no shell host started. A new state folder still
  gains the server's id, secrets and lock files before the refusal; an existing one already has them.
- Dev risk: `migrate-dev-db` now fails on a `~/.t3` source that an upstream T3 Code build migrated
  past this checkout's last migration, and `vp run dev` then starts with an empty database.
- AC-12 of PRB.T-032 with two real builds was not run: no migration lies between installed builds.
