// @effect-diagnostics nodeBuiltinImport:off - Runs the ticket manager as a real subprocess on a temp copy of the fixtures.

import { it } from "@effect/vitest";
import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { allocateId, loadTickets, parseTicket, serializeTicket, slugify } from "./ticket.ts";

const here = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const ticketManager = NodePath.join(here, "ticket-manager.ts");

function sandbox(): string {
  const d = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "tm-"));
  NodeFS.cpSync(NodePath.join(here, "..", "fixtures", "tm"), d, { recursive: true });
  return d;
}
const tm = (d: string, ...a: string[]) =>
  NodeChildProcess.execFileSync(process.execPath, [ticketManager, ...a], {
    env: { ...process.env, TM_ROOT: d },
    encoding: "utf8",
  });

it("status comes from the folder and files round-trip", () => {
  const tickets = loadTickets(sandbox());
  NodeAssert.deepEqual(
    tickets.map((t) => [t.id, t.status]),
    [
      ["PRB.E-001", "in-progress"],
      ["PRB.E-002", "backlog"],
      ["PRB.T-001", "backlog"],
    ],
  );
  for (const t of tickets) {
    const text = NodeFS.readFileSync(t.file, "utf8");
    NodeAssert.equal(serializeTicket(parseTicket(text, t.file, t.status)), text);
  }
});

it("a status field in the file is rejected", () => {
  NodeAssert.throws(
    () => parseTicket("---\nid: PRB.T-001\nstatus: done\n---\n"),
    /status is the folder/,
  );
});

it("ids come from ids.json, count separately, and are never reused", () => {
  const d = sandbox();
  NodeAssert.equal(allocateId(d, "epic"), "PRB.E-003");
  NodeAssert.equal(allocateId(d, "task"), "PRB.T-002");
  NodeAssert.equal(allocateId(d, "task"), "PRB.T-003");
  NodeAssert.deepEqual(JSON.parse(NodeFS.readFileSync(NodePath.join(d, "ids.json"), "utf8")), {
    epic: 3,
    task: 3,
  });
  NodeAssert.ok(!NodeFS.existsSync(NodePath.join(d, ".ids.lock")));
  // deleting the newest ticket does not free its number
  NodeFS.rmSync(NodePath.join(d, "tasks", "backlog", "PRB.T-001-first.md"));
  NodeAssert.equal(allocateId(d, "task"), "PRB.T-004");
});

it("parallel tm new never issues the same id", async () => {
  const d = sandbox();
  const run = (i: number) =>
    new Promise<void>((ok, bad) =>
      NodeChildProcess.execFile(
        process.execPath,
        [ticketManager, "new", "bug", `Bug ${i}`],
        { env: { ...process.env, TM_ROOT: d } },
        (e) => (e ? bad(e) : ok()),
      ),
    );
  await Promise.all(Array.from({ length: 12 }, (_, i) => run(i)));
  const ids = NodeFS.readdirSync(NodePath.join(d, "tasks", "backlog")).map((f) => f.slice(0, 9));
  NodeAssert.equal(new Set(ids).size, ids.length);
  NodeAssert.equal(ids.length, 13);
  NodeAssert.equal(tm(d, "check").trim(), "ok: 15 tickets, ids unique");
});

it("check catches duplicates, a stale counter, and a missing parent", () => {
  const d = sandbox();
  NodeAssert.match(tm(d, "check"), /^ok/);
  NodeFS.cpSync(
    NodePath.join(d, "tasks", "backlog", "PRB.T-001-first.md"),
    NodePath.join(d, "tasks", "done", "PRB.T-001-first-copy.md"),
  );
  NodeAssert.throws(() => tm(d, "check"), /duplicate id PRB\.T-001/);
  NodeAssert.throws(() => tm(d, "ls"), /duplicate id PRB\.T-001/);
  NodeFS.rmSync(NodePath.join(d, "tasks", "done", "PRB.T-001-first-copy.md"));
  NodeFS.writeFileSync(NodePath.join(d, "ids.json"), '{"epic": 2, "task": 0}');
  NodeAssert.throws(() => tm(d, "check"), /task counter 0 is behind the highest task id 1/);
  NodeAssert.throws(() => tm(d, "new", "bug", "x"), /behind the files/);
  NodeFS.writeFileSync(NodePath.join(d, "ids.json"), '{"epic": 2, "task": 1}');
  const f = NodePath.join(d, "tasks", "backlog", "PRB.T-001-first.md");
  NodeFS.writeFileSync(
    f,
    NodeFS.readFileSync(f, "utf8").replace("parent: PRB.E-001", "parent: PRB.E-009"),
  );
  NodeAssert.throws(() => tm(d, "check"), /parent PRB\.E-009 is not an existing epic/);
});

it("slugify cuts at a word boundary", () => {
  NodeAssert.equal(
    slugify("Remove web mode and marketing; trim packages"),
    "remove-web-mode-and-marketing-trim",
  );
});

it("new story and bug land in tasks/backlog; a bug needs no epic", () => {
  const d = sandbox();
  tm(d, "new", "story", "Second thing", "--parent", "PRB.E-002");
  const f = NodePath.join(d, "tasks", "backlog", "PRB.T-002-second-thing.md");
  NodeAssert.match(NodeFS.readFileSync(f, "utf8"), /type: story\nparent: PRB\.E-002\nphase: 3\n/);
  NodeAssert.doesNotMatch(NodeFS.readFileSync(f, "utf8"), /status:/);
  tm(d, "new", "bug", "Crash on open");
  NodeAssert.ok(
    NodeFS.existsSync(NodePath.join(d, "tasks", "backlog", "PRB.T-003-crash-on-open.md")),
  );
  NodeAssert.throws(() => tm(d, "new", "story", "orphan"));
});

it("mv moves the file between status folders and board follows", () => {
  const d = sandbox();
  tm(d, "mv", "PRB.T-001", "in-progress");
  NodeAssert.ok(NodeFS.existsSync(NodePath.join(d, "tasks", "in-progress", "PRB.T-001-first.md")));
  NodeAssert.ok(!NodeFS.existsSync(NodePath.join(d, "tasks", "backlog", "PRB.T-001-first.md")));
  NodeAssert.match(
    tm(d, "board"),
    /IN-PROGRESS \(1\)\n {2}PRB\.T-001 story \[E-001\] First story {2}\[plan\]/,
  );
  tm(d, "mv", "PRB.E-002", "done");
  NodeAssert.ok(NodeFS.existsSync(NodePath.join(d, "epics", "done", "PRB.E-002-beta.md")));
});

it("rm deletes a ticket, refuses an epic with tasks, and never frees the id", () => {
  const d = sandbox();
  NodeAssert.throws(() => tm(d, "rm", "PRB.E-001"), /still has tasks: PRB\.T-001/);
  tm(d, "rm", "PRB.T-001");
  NodeAssert.ok(!NodeFS.existsSync(NodePath.join(d, "tasks", "backlog", "PRB.T-001-first.md")));
  tm(d, "rm", "PRB.E-001");
  NodeAssert.ok(!NodeFS.existsSync(NodePath.join(d, "epics", "in-progress", "PRB.E-001-alpha.md")));
  NodeAssert.match(tm(d, "new", "bug", "after delete"), /PRB\.T-002/);
  NodeAssert.match(tm(d, "check"), /^ok/);
  NodeAssert.throws(() => tm(d, "rm", "PRB.T-099"));
});

it("label adds and removes", () => {
  const d = sandbox();
  tm(d, "label", "PRB.T-001", "+implement", "-plan");
  NodeAssert.match(
    NodeFS.readFileSync(NodePath.join(d, "tasks", "backlog", "PRB.T-001-first.md"), "utf8"),
    /labels: \[implement\]/,
  );
});

it("rejects bad status, unknown ticket, and a non-epic parent", () => {
  const d = sandbox();
  NodeAssert.throws(() => tm(d, "mv", "PRB.T-001", "review"));
  NodeAssert.throws(() => tm(d, "mv", "PRB.T-099", "done"));
  NodeAssert.throws(() => tm(d, "new", "story", "x", "--parent", "PRB.T-001"));
});
