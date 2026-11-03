// @effect-diagnostics nodeBuiltinImport:off globalDate:off - Plain Node so the ticket manager runs with no install step.

import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

// Status is the folder a ticket sits in: epics/<status>/ or tasks/<status>/.
export const STATUSES = ["backlog", "in-progress", "done"] as const;
export const KINDS = ["epics", "tasks"] as const;
export const TASK_TYPES = ["story", "bug"] as const;
const KEYS = ["id", "type", "parent", "phase", "labels", "was", "created", "updated"] as const;
const FILE_RE = /^(PRB\.[ET]-\d{3,})(?:-.*)?\.md$/;

export interface Ticket {
  id: string;
  type: string; // epic | story | bug
  status: string; // derived from the folder, never written to the file
  parent: string;
  phase: string;
  labels: string[];
  was: string[];
  created: string;
  updated: string;
  body: string;
  file: string;
}

export function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function parseList(raw: string, what: string, file: string): string[] {
  const m = raw.match(/^\[(.*)\]$/);
  if (!m) throw new Error(`${file}: ${what} must be an inline list`);
  return (m[1] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseTicket(text: string, file = "", status = ""): Ticket {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error(`${file}: missing frontmatter`);
  const raw: Record<string, string> = {};
  for (const line of (m[1] ?? "").split("\n")) {
    const kv = line.match(/^(\w+):[ \t]*(.*?)\s*(?:#.*)?$/);
    if (!kv) throw new Error(`${file}: bad frontmatter line: ${line}`);
    const [, key = "", value = ""] = kv;
    raw[key] = value;
  }
  if ("status" in raw) throw new Error(`${file}: status is the folder, remove it from the file`);
  for (const k of KEYS)
    if (k !== "was" && !(k in raw)) throw new Error(`${file}: missing key '${k}'`);
  const labels = parseList(raw.labels ?? "", "labels", file);
  const was = "was" in raw ? parseList(raw.was ?? "", "was", file) : [];
  return { ...(raw as unknown as Ticket), status, labels, was, body: m[2] ?? "", file };
}

export function serializeTicket(t: Ticket): string {
  const lines = KEYS.flatMap((k) => {
    if (k === "labels") return [`labels: [${t.labels.join(", ")}]`];
    if (k === "was") return t.was.length ? [`was: [${t.was.join(", ")}]`] : [];
    const v = t[k];
    return [v === "" ? `${k}:` : `${k}: ${v}`];
  });
  return `---\n${lines.join("\n")}\n---\n${t.body}`;
}

export function loadTickets(root: string, strict = true): Ticket[] {
  const out: Ticket[] = [];
  for (const kind of KINDS) {
    const letter = kind === "epics" ? "E" : "T";
    for (const status of STATUSES) {
      const dir = NodePath.join(root, kind, status);
      if (!NodeFS.existsSync(dir)) continue;
      for (const name of NodeFS.readdirSync(dir).sort()) {
        const m = name.match(FILE_RE);
        if (!m) continue;
        const file = NodePath.join(dir, name);
        const t = parseTicket(NodeFS.readFileSync(file, "utf8"), file, status);
        if (t.id !== m[1] || t.id[4] !== letter)
          throw new Error(`${file}: id does not match its file name or folder`);
        const okType =
          kind === "epics" ? t.type === "epic" : (TASK_TYPES as readonly string[]).includes(t.type);
        if (!okType) throw new Error(`${file}: type '${t.type}' is not valid in ${kind}/`);
        if (strict && out.some((o) => o.id === t.id)) {
          throw new Error(
            `duplicate id ${t.id}: ${out.find((o) => o.id === t.id)!.file} and ${file}`,
          );
        }
        out.push(t);
      }
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

type Kind = "epic" | "task";
const LETTER: Record<Kind, string> = { epic: "E", task: "T" };
const idNumber = (id: string) => Number(id.slice(6));

// ids.json holds the last number issued per kind. It only goes up, so deleting a ticket never frees
// an ID, and it is tracked in git so two branches issuing the same number conflict on merge.
export function readCounters(root: string): Record<Kind, number> {
  const f = NodePath.join(root, "ids.json");
  if (!NodeFS.existsSync(f)) throw new Error("tm: ids.json is missing (run `tm check` to see why)");
  const c = JSON.parse(NodeFS.readFileSync(f, "utf8"));
  return { epic: Number(c.epic), task: Number(c.task) };
}

export function maxSeen(tickets: Ticket[], kind: Kind): number {
  return tickets
    .filter((t) => t.id[4] === LETTER[kind])
    .reduce((n, t) => Math.max(n, idNumber(t.id)), 0);
}

function withLock<T>(root: string, fn: () => T): T {
  const lock = NodePath.join(root, ".ids.lock");
  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      NodeFS.closeSync(NodeFS.openSync(lock, "wx"));
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      // A crashed tm leaves the lock behind; a live holder keeps it for milliseconds. The holder
      // may release it between our failed create and these calls, which just means retry.
      try {
        if (Date.now() - NodeFS.statSync(lock).mtimeMs > 5_000) NodeFS.unlinkSync(lock);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
      if (!NodeFS.existsSync(lock)) continue;
      if (Date.now() > deadline) throw new Error("tm: timed out waiting for the ID lock");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  try {
    return fn();
  } finally {
    NodeFS.unlinkSync(lock);
  }
}

export function allocateId(root: string, kind: Kind): string {
  return withLock(root, () => {
    const counters = readCounters(root);
    const seen = maxSeen(loadTickets(root), kind);
    if (seen > counters[kind]) {
      throw new Error(
        `tm: ids.json (${kind} ${counters[kind]}) is behind the files (${seen}); fix it before creating tickets`,
      );
    }
    const next = counters[kind] + 1;
    const tmp = NodePath.join(root, "ids.json.tmp");
    NodeFS.writeFileSync(tmp, JSON.stringify({ ...counters, [kind]: next }, null, 2) + "\n");
    NodeFS.renameSync(tmp, NodePath.join(root, "ids.json"));
    return `PRB.${LETTER[kind]}-${String(next).padStart(3, "0")}`;
  });
}

export function checkVault(root: string): string[] {
  const problems: string[] = [];
  let tickets: Ticket[] = [];
  try {
    tickets = loadTickets(root, false);
  } catch (e) {
    return [(e as Error).message];
  }
  const byId = new Map<string, Ticket[]>();
  for (const t of tickets) byId.set(t.id, [...(byId.get(t.id) ?? []), t]);
  for (const [id, ts] of byId) {
    if (ts.length > 1) problems.push(`duplicate id ${id}: ${ts.map((t) => t.file).join(", ")}`);
  }
  try {
    const counters = readCounters(root);
    for (const kind of ["epic", "task"] as const) {
      const seen = maxSeen(tickets, kind);
      if (seen > counters[kind])
        problems.push(
          `ids.json ${kind} counter ${counters[kind]} is behind the highest ${kind} id ${seen}`,
        );
    }
  } catch (e) {
    problems.push((e as Error).message);
  }
  for (const t of tickets) {
    if (t.type === "epic" && t.parent) problems.push(`${t.id}: an epic has no parent`);
    if (t.type === "story" && !t.parent) problems.push(`${t.id}: a story needs a parent epic`);
    if (t.parent && byId.get(t.parent)?.[0]?.type !== "epic")
      problems.push(`${t.id}: parent ${t.parent} is not an existing epic`);
  }
  return problems;
}

export function slugify(title: string): string {
  const s = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (s.length <= 40) return s;
  const cut = s.slice(0, 40).lastIndexOf("-");
  return s.slice(0, cut > 0 ? cut : 40);
}

export function ticketFile(
  root: string,
  t: Pick<Ticket, "id" | "type">,
  status: string,
  title: string,
): string {
  const kind = t.type === "epic" ? "epics" : "tasks";
  return NodePath.join(root, kind, status, `${t.id}-${slugify(title)}.md`);
}

// Write to a dot-file and rename, so a concurrent tm never reads a half-written ticket.
export function saveTicket(t: Ticket): void {
  NodeFS.mkdirSync(NodePath.dirname(t.file), { recursive: true });
  const tmp = NodePath.join(
    NodePath.dirname(t.file),
    `.${NodePath.basename(t.file)}.${process.pid}.tmp`,
  );
  NodeFS.writeFileSync(tmp, serializeTicket(t));
  NodeFS.renameSync(tmp, t.file);
}

export function moveTicket(t: Ticket, status: string): void {
  const dest = NodePath.join(
    NodePath.dirname(NodePath.dirname(t.file)),
    status,
    NodePath.basename(t.file),
  );
  NodeFS.mkdirSync(NodePath.dirname(dest), { recursive: true });
  NodeFS.renameSync(t.file, dest);
  t.file = dest;
  t.status = status;
}

export function titleOf(t: Ticket): string {
  return t.body.match(/^# (.+)$/m)?.[1] ?? "(untitled)";
}
