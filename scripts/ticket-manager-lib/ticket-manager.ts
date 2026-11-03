// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - Plain Node CLI that prints to the terminal.

import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";
import {
  STATUSES,
  TASK_TYPES,
  allocateId,
  checkVault,
  loadTickets,
  moveTicket,
  saveTicket,
  ticketFile,
  titleOf,
  today,
  type Ticket,
} from "./ticket.ts";

const USAGE = `usage: tm <command>
  new epic "<title>" [--phase N] [--labels a,b]
  new story|bug "<title>" [--parent EPIC_ID] [--phase N] [--labels a,b]   (a story needs --parent)
  ls [--status s] [--phase N] [--label l] [--parent ID] [--type epic|story|bug]
  show <ID>
  mv <ID> <status>        status: ${STATUSES.join(" | ")} (moves the file between folders)
  rm <ID>                 delete a ticket file (an epic must have no tasks); its ID stays reserved
  label <ID> <+label|-label>...   add or remove labels, e.g. +plan -spec
  board [--phase N] [--epic ID]   tasks by status
  check                   verify IDs are unique, ids.json is ahead of every ticket, parents exist
  log "<text>"

IDs come from ids.json, only ever increase, and are issued under a lock. PRB.E-NNN epics (epics/<status>/), PRB.T-NNN tasks (tasks/<status>/). Status is the folder.
Workflow stages (plan, implement, verify, review) are optional labels, not statuses.`;

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

const root =
  process.env.TM_ROOT ?? NodeURL.fileURLToPath(new URL("../../docs/dev", import.meta.url));
const [cmd, ...rest] = process.argv.slice(2);

const line = (t: Ticket) =>
  `${t.id}  ${t.type.padEnd(5)}  ${t.status.padEnd(11)}  p${t.phase || "-"}  ${titleOf(t)}${
    t.labels.length ? `  [${t.labels.join(", ")}]` : ""
  }`;

function find(tickets: Ticket[], id?: string): Ticket {
  const t = tickets.find((x) => x.id === id);
  if (!t) fail(`tm: no such ticket: ${id ?? "(missing id)"}`);
  return t;
}

function main() {
  if (cmd === "check") {
    const problems = checkVault(root);
    if (problems.length) fail("tm check failed:\n" + problems.map((p) => `  - ${p}`).join("\n"));
    console.log(`ok: ${loadTickets(root).length} tickets, ids unique`);
    return;
  }
  const tickets = loadTickets(root);
  switch (cmd) {
    case "new": {
      const { values, positionals } = NodeUtil.parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          parent: { type: "string" },
          phase: { type: "string" },
          labels: { type: "string" },
        },
      });
      const [type = "", title = ""] = positionals;
      if (!["epic", ...TASK_TYPES].includes(type as never) || !title) fail(USAGE);
      let parent: Ticket | undefined;
      if (type === "epic") {
        if (values.parent) fail("tm: an epic takes no --parent");
      } else {
        if (type === "story" && !values.parent) fail("tm: a story needs --parent");
        if (values.parent) {
          parent = find(tickets, values.parent);
          if (parent.type !== "epic") fail(`tm: parent ${parent.id} is not an epic`);
        }
      }
      const id = allocateId(root, type === "epic" ? "epic" : "task");
      const t: Ticket = {
        id,
        type,
        status: "backlog",
        parent: parent?.id ?? "",
        phase: values.phase ?? parent?.phase ?? "",
        labels: (values.labels ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        was: [],
        created: today(),
        updated: today(),
        file: ticketFile(root, { id, type }, "backlog", title),
        body: `\n# ${title}\n\n_Describe the work._\n\n## Done when\n\n_TBD._\n`,
      };
      saveTicket(t);
      console.log(`created ${id}  ${t.file}`);
      return;
    }
    case "ls": {
      const { values } = NodeUtil.parseArgs({
        args: rest,
        options: {
          status: { type: "string" },
          phase: { type: "string" },
          label: { type: "string" },
          parent: { type: "string" },
          type: { type: "string" },
        },
      });
      tickets
        .filter((t) => !values.status || t.status === values.status)
        .filter((t) => !values.phase || t.phase === values.phase)
        .filter((t) => !values.label || t.labels.includes(values.label))
        .filter((t) => !values.parent || t.parent === values.parent)
        .filter((t) => !values.type || t.type === values.type)
        .forEach((t) => console.log(line(t)));
      return;
    }
    case "show": {
      const t = find(tickets, rest[0]);
      console.log(`# status: ${t.status}`);
      process.stdout.write(NodeFS.readFileSync(t.file, "utf8"));
      if (t.type === "epic") {
        const kids = tickets.filter((x) => x.parent === t.id);
        if (kids.length) console.log("\nTasks:\n" + kids.map((k) => `  ${line(k)}`).join("\n"));
      }
      return;
    }
    case "mv": {
      const t = find(tickets, rest[0]);
      const status = rest[1] ?? "";
      if (!STATUSES.includes(status as never))
        fail(`tm: status must be one of ${STATUSES.join(", ")}`);
      if (t.status !== status) moveTicket(t, status);
      t.updated = today();
      saveTicket(t);
      console.log(`${t.id} -> ${status}`);
      if (status === "done") {
        console.log("Reminder: list what should be promoted to docs/ outside docs/dev.");
      }
      return;
    }
    case "rm": {
      const t = find(tickets, rest[0]);
      const kids = tickets.filter((x) => x.parent === t.id);
      if (kids.length)
        fail(
          `tm: ${t.id} still has tasks: ${kids.map((k) => k.id).join(", ")}; move or remove them first`,
        );
      NodeFS.rmSync(t.file);
      console.log(
        `removed ${t.id}  ${t.file}\n${t.id} stays reserved in ids.json and is never reused`,
      );
      return;
    }
    case "label": {
      const t = find(tickets, rest[0]);
      const ops = rest.slice(1);
      if (!ops.length || ops.some((o) => !/^[+-][\w-]+$/.test(o)))
        fail("tm: use +label to add, -label to remove");
      for (const o of ops) {
        const l = o.slice(1);
        t.labels = o[0] === "+" ? [...new Set([...t.labels, l])] : t.labels.filter((x) => x !== l);
      }
      t.updated = today();
      saveTicket(t);
      console.log(`${t.id}  [${t.labels.join(", ")}]`);
      return;
    }
    case "board": {
      const { values } = NodeUtil.parseArgs({
        args: rest,
        options: { phase: { type: "string" }, epic: { type: "string" } },
      });
      const tasks = tickets.filter(
        (t) =>
          t.type !== "epic" &&
          (!values.phase || t.phase === values.phase) &&
          (!values.epic || t.parent === values.epic),
      );
      for (const s of STATUSES) {
        const col = tasks.filter((t) => t.status === s);
        console.log(`${s.toUpperCase()} (${col.length})`);
        col.forEach((t) =>
          console.log(
            `  ${t.id} ${t.type}${t.parent ? ` [${t.parent.slice(4)}]` : ""} ${titleOf(t)}${t.labels.length ? `  [${t.labels.join(", ")}]` : ""}`,
          ),
        );
      }
      return;
    }
    case "log": {
      const text = rest.join(" ").trim();
      if (!text) fail(USAGE);
      const dir = NodePath.join(root, "memory", "log");
      NodeFS.mkdirSync(dir, { recursive: true });
      const f = NodePath.join(dir, `${today()}.md`);
      if (!NodeFS.existsSync(f)) NodeFS.writeFileSync(f, `# ${today()}\n\n`);
      NodeFS.appendFileSync(f, `- ${text}\n`);
      console.log(`logged to ${f}`);
      return;
    }
    default:
      fail(USAGE);
  }
}

try {
  main();
} catch (e) {
  fail((e as Error).message);
}
