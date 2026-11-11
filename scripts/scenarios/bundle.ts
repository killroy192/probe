// @effect-diagnostics nodeBuiltinImport:off globalDate:off - Reads the checkout's file times to judge the web bundle, and rebuilds it.

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeReadline from "node:readline";
import * as NodeUtil from "node:util";

import { childEnv } from "./server.ts";

const WEB_INPUTS = ["src", "public", "vite", "index.html", "vite.config.ts", "package.json"];
const PACKAGE_INPUTS = ["src", "package.json"];
const SKIPPED = new Set(["node_modules", "dist", ".turbo"]);

export interface BundleState {
  readonly state: "missing" | "stale" | "current";
  /** When `dist/index.html` was written; null when it is missing. */
  readonly builtMs: number | null;
  /** The newest input, the one that makes a bundle stale. */
  readonly newest: { readonly path: string; readonly mtimeMs: number } | null;
}

const readJson = (file: string) =>
  JSON.parse(NodeFS.readFileSync(file, "utf8")) as {
    readonly name?: string;
    readonly dependencies?: Record<string, string>;
    readonly devDependencies?: Record<string, string>;
  };

/** Workspace packages by name, from `<root>/packages/*`. */
function workspacePackages(root: string): ReadonlyMap<string, string> {
  const found = new Map<string, string>();
  const dir = NodePath.join(root, "packages");
  for (const entry of NodeFS.existsSync(dir) ? NodeFS.readdirSync(dir) : []) {
    const manifest = NodePath.join(dir, entry, "package.json");
    if (!NodeFS.existsSync(manifest)) continue;
    const name = readJson(manifest).name;
    if (name !== undefined) found.set(name, NodePath.join(dir, entry));
  }
  return found;
}

/**
 * An app's inputs and those of every workspace package it uses, directly or not. Only runtime
 * dependencies count past the app itself; `withDev` adds the app's own dev ones.
 */
function appInputs(
  root: string,
  app: string,
  appEntries: ReadonlyArray<string>,
  withDev: boolean,
): ReadonlyArray<string> {
  const packages = workspacePackages(root);
  const dir = NodePath.join(root, "apps", app);
  const inputs = appEntries.map((input) => NodePath.join(dir, input));
  const appManifest = readJson(NodePath.join(dir, "package.json"));
  const queue = [
    { ...appManifest.dependencies, ...(withDev ? appManifest.devDependencies : undefined) },
  ];
  const seen = new Set<string>();
  while (queue.length > 0) {
    for (const [name, version] of Object.entries(queue.shift()!)) {
      const packageDir = packages.get(name);
      if (!version.startsWith("workspace:") || packageDir === undefined || seen.has(packageDir)) {
        continue;
      }
      seen.add(packageDir);
      inputs.push(...PACKAGE_INPUTS.map((input) => NodePath.join(packageDir, input)));
      queue.push(readJson(NodePath.join(packageDir, "package.json")).dependencies ?? {});
    }
  }
  return inputs;
}

/** The web app's inputs and those of every workspace package it uses; dev ones (test kits) are not bundled. */
export const bundleInputs = (root: string) => appInputs(root, "web", WEB_INPUTS, false);

/** What the server loads from source when it starts; it runs with its dev dependencies linked. */
export const serverInputs = (root: string) =>
  appInputs(root, "server", PACKAGE_INPUTS, true).filter(
    (input) => !input.startsWith(NodePath.join(root, "apps", "web") + NodePath.sep),
  );

function newestUnder(path: string, newest: { path: string; mtimeMs: number } | null) {
  let stat: NodeFS.Stats;
  try {
    stat = NodeFS.statSync(path);
  } catch {
    return newest;
  }
  if (!stat.isDirectory()) {
    return newest === null || stat.mtimeMs > newest.mtimeMs
      ? { path, mtimeMs: stat.mtimeMs }
      : newest;
  }
  let result = newest;
  for (const entry of NodeFS.readdirSync(path)) {
    if (SKIPPED.has(entry)) continue;
    result = newestUnder(NodePath.join(path, entry), result);
  }
  return result;
}

/** The newest file under `inputs`, or null when none exists. */
export function newestOf(inputs: ReadonlyArray<string>) {
  let newest: { path: string; mtimeMs: number } | null = null;
  for (const input of inputs) newest = newestUnder(input, newest);
  return newest;
}

/** When `<root>/apps/web/dist/index.html` was written; null when it is missing. */
export function bundleBuiltMs(root: string): number | null {
  try {
    return NodeFS.statSync(NodePath.join(root, "apps", "web", "dist", "index.html")).mtimeMs;
  } catch {
    return null;
  }
}

/** Whether `<root>/apps/web/dist` is older than any of its inputs. */
export function bundleState(root: string): BundleState {
  const newest = newestOf(bundleInputs(root));
  const builtMs = bundleBuiltMs(root);
  if (builtMs === null) return { state: "missing", builtMs: null, newest };
  return {
    state: newest !== null && newest.mtimeMs > builtMs ? "stale" : "current",
    builtMs,
    newest,
  };
}

/** Rebuilds the web bundle when it is missing, older than its sources or `--rebuild` asks. */
export async function ensureWebBundle(
  root: string,
  rebuild: boolean,
  write: (line: string) => void,
  ambient: NodeJS.ProcessEnv = NodeProcess.env,
): Promise<BundleState> {
  const before = bundleState(root);
  const fromRoot = (path: string) => NodePath.relative(root, path);
  const reason = rebuild
    ? "--rebuild"
    : before.state === "missing"
      ? "no bundle yet"
      : before.state === "stale" && before.newest !== null
        ? `${fromRoot(before.newest.path)} is newer`
        : null;
  if (reason !== null) {
    write(`scenarios: building the web bundle (${reason})`);
    await new Promise<void>((resolve, reject) => {
      const build = NodeChildProcess.spawn("vp", ["run", "--filter", "@t3tools/web", "build"], {
        cwd: root,
        // A caller's `VITE_*` would be baked into the bundle every later run serves.
        env: childEnv({}, ambient),
        stdio: ["ignore", "pipe", "pipe"],
      });
      // The build colours some warnings even under NO_COLOR, and the output is read as a log.
      for (const stream of [build.stdout, build.stderr]) {
        NodeReadline.createInterface({ input: stream }).on("line", (line) =>
          write(NodeUtil.stripVTControlCharacters(line)),
        );
      }
      build.once("error", (error) =>
        reject(new Error(`Could not run the web build: ${error.message}`)),
      );
      build.once("exit", (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`The web build failed (exit code ${String(code)}).`)),
      );
    });
  }
  const after = bundleState(root);
  const built = after.builtMs === null ? "never" : new Date(after.builtMs).toISOString();
  write(
    `scenarios: web bundle ${reason === null ? "current, reused" : "rebuilt"}, built ${built}${
      after.state === "stale" ? " (a source changed during the build; run again to rebuild)" : ""
    }`,
  );
  return after;
}
