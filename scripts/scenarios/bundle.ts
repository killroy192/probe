// @effect-diagnostics nodeBuiltinImport:off globalDate:off - Reads the checkout's file times to judge the web bundle, and rebuilds it.

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

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

/** The web app's inputs and those of every workspace package it uses, directly or not. */
export function bundleInputs(root: string): ReadonlyArray<string> {
  const packages = workspacePackages(root);
  const web = NodePath.join(root, "apps", "web");
  const inputs = WEB_INPUTS.map((input) => NodePath.join(web, input));
  const queue = [NodePath.join(web, "package.json")];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const manifest = readJson(queue.shift()!);
    // Only runtime dependencies end up in the bundle; dev ones (test kits) do not.
    for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
      const dir = packages.get(name);
      if (!version.startsWith("workspace:") || dir === undefined || seen.has(dir)) continue;
      seen.add(dir);
      inputs.push(...PACKAGE_INPUTS.map((input) => NodePath.join(dir, input)));
      queue.push(NodePath.join(dir, "package.json"));
    }
  }
  return inputs;
}

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

/** Whether `<root>/apps/web/dist` is older than any of its inputs. */
export function bundleState(root: string): BundleState {
  let newest: { path: string; mtimeMs: number } | null = null;
  for (const input of bundleInputs(root)) newest = newestUnder(input, newest);
  let builtMs: number | null = null;
  try {
    builtMs = NodeFS.statSync(NodePath.join(root, "apps", "web", "dist", "index.html")).mtimeMs;
  } catch {
    return { state: "missing", builtMs: null, newest };
  }
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
        stdio: ["ignore", "inherit", "inherit"],
      });
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
