// @effect-diagnostics nodeBuiltinImport:off - Writes a failure's artifacts into the run's folder.

import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import type { PointerPage } from "../browser.ts";
import type { ServerHandle } from "../server.ts";
import { redact } from "./report.ts";
import { recorderTails } from "./waits.ts";

/** A failure inside a named stage of a scenario; code outside every stage is in the stage `setup`. */
export class StageFailure extends Error {
  readonly stage: string;
  override readonly cause: unknown;

  constructor(stage: string, cause: unknown) {
    super(`at stage "${stage}": ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "StageFailure";
    this.stage = stage;
    this.cause = cause;
  }
}

/** The stage that code outside every `stage()` call runs in. */
const SETUP_STAGE = "setup";

/** One setup call a scenario made: never auth data. */
export interface TrailNote {
  readonly call: string;
  readonly asked: unknown;
  readonly got: unknown;
}

interface SavedArtifacts {
  readonly saved: ReadonlyArray<string>;
  /** One `<file>: <why>` per piece that could not be saved. */
  readonly missing: ReadonlyArray<string>;
}

/** What one run of a scenario did: its stages, setup calls, servers and pages. */
export interface Trail {
  /** Runs `body` as the stage `name`, marking every server's log; a throw is wrapped once as a `StageFailure`. */
  readonly stage: <A>(name: string, body: () => Promise<A>) => Promise<A>;
  /** Runs `body` with every stage name prefixed by `step`, for a composed scenario's steps. */
  readonly within: <A>(step: string, body: () => Promise<A>) => Promise<A>;
  /** The innermost stage running now, `setup` outside every stage. */
  readonly current: () => string;
  readonly note: (entry: TrailNote) => void;
  readonly notes: () => ReadonlyArray<TrailNote>;
  /** Records `server`'s log from now on under `label`; a label taken already gets a number. */
  readonly addServer: (label: string, server: ServerHandle) => void;
  /** Records `page`'s console and page errors from now on; it is saved as `page-<n>-<label>`. */
  readonly addPage: (label: string, page: PointerPage) => void;
  /** How many bytes of log each server printed since it was added, by label. */
  readonly logSizes: () => ReadonlyArray<{ readonly label: string; readonly bytes: number }>;
  /** Saves `error`'s artifacts into `dir`, each piece on its own, every text redacted. */
  readonly save: (dir: string, error: unknown) => Promise<SavedArtifacts>;
}

interface ServerSource {
  readonly label: string;
  readonly server: ServerHandle;
  readonly mark: number;
}

interface PageSource {
  readonly name: string;
  readonly page: PointerPage;
  readonly console: Array<string>;
}

const firstLine = (cause: unknown) =>
  cause instanceof Error ? (cause.message.split("\n")[0] ?? "") : String(cause);

const fileLabel = (label: string) => label.trim().replace(/[^\w.-]+/g, "-");

function describeError(error: unknown): string {
  const parts: Array<string> = [];
  let current: unknown = error;
  for (let depth = 0; current !== undefined && depth < 5; depth++) {
    parts.push(current instanceof Error ? (current.stack ?? current.message) : String(current));
    current = current instanceof Error ? current.cause : undefined;
  }
  return parts.join("\nCaused by: ");
}

export function createTrail(): Trail {
  const notes: Array<TrailNote> = [];
  const servers: Array<ServerSource> = [];
  const pages: Array<PageSource> = [];
  const stack: Array<string> = [];
  // The marks each stage started with, by full stage name; the last start of a name wins.
  const stageMarks = new Map<string, ReadonlyMap<string, number>>();
  let prefix = "";

  const marksNow = () => new Map(servers.map(({ label, server }) => [label, server.logMark()]));
  const markAt = (stage: string, source: ServerSource) =>
    Math.max(stageMarks.get(stage)?.get(source.label) ?? source.mark, source.mark);

  const save = async (dir: string, error: unknown): Promise<SavedArtifacts> => {
    const saved: Array<string> = [];
    const missing: Array<string> = [];
    const attempt = async (name: string, write: (path: string) => Promise<unknown>) => {
      try {
        await write(NodePath.join(dir, name));
        saved.push(name);
      } catch (cause) {
        missing.push(`${name}: ${firstLine(cause)}`);
      }
    };
    const text = (name: string, read: () => string) =>
      attempt(name, (path) => NodeFSP.writeFile(path, redact(read())));
    try {
      await NodeFSP.mkdir(dir, { recursive: true });
    } catch (cause) {
      return { saved, missing: [`${dir}: ${firstLine(cause)}`] };
    }
    await text("error.txt", () => describeError(error));
    for (const { name, page, console } of pages) {
      await attempt(`${name}.png`, async (path) => {
        if (page.isClosed()) throw new Error("the page was closed before the failure");
        await page.screenshot({ path, fullPage: true, timeout: 5_000 });
      });
      await text(`${name}.console.txt`, () => console.join("\n"));
    }
    const failedStage = error instanceof StageFailure ? error.stage : SETUP_STAGE;
    for (const source of servers) {
      await text(`${source.label}.stage.log`, () =>
        source.server.logSince(markAt(failedStage, source)),
      );
      await text(`${source.label}.log`, () => source.server.logSince(source.mark));
    }
    await text("setup.json", () => JSON.stringify(notes, null, 2));
    await text("recorders.json", () => JSON.stringify(recorderTails(), null, 2));
    return { saved, missing };
  };

  return {
    stage: async (name, body) => {
      const stage = `${prefix}${name}`;
      stageMarks.set(stage, marksNow());
      stack.push(stage);
      try {
        return await body();
      } catch (cause) {
        throw cause instanceof StageFailure ? cause : new StageFailure(stage, cause);
      } finally {
        stack.pop();
      }
    },
    within: async (step, body) => {
      const outer = prefix;
      prefix = `${outer}${step}: `;
      try {
        return await body();
      } finally {
        prefix = outer;
      }
    },
    current: () => stack.at(-1) ?? `${prefix}${SETUP_STAGE}`,
    note: (entry) => {
      notes.push(entry);
    },
    notes: () => notes,
    addServer: (label, server) => {
      const base = fileLabel(label);
      let unique = base;
      for (let n = 2; servers.some((source) => source.label === unique); n++) {
        unique = `${base}-${n}`;
      }
      servers.push({ label: unique, server, mark: server.logMark() });
    },
    addPage: (label, page) => {
      const source: PageSource = {
        name: `page-${pages.length + 1}-${fileLabel(label)}`,
        page,
        console: [],
      };
      pages.push(source);
      page.on("console", (message) => {
        source.console.push(`[${message.type()}] ${message.text()}`);
      });
      page.on("pageerror", (error) => {
        source.console.push(`[pageerror] ${error.stack ?? error.message}`);
      });
    },
    logSizes: () =>
      servers.map(({ label, server, mark }) => ({ label, bytes: server.logMark() - mark })),
    save,
  };
}
