// @effect-diagnostics nodeBuiltinImport:off - A plain loader for Node callers, with no Effect runtime.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { GhosttyRuntime } from "./runtime.ts";

/** The two wasm files a runtime loads; a bundled server copies them into a folder of its own. */
export const GHOSTTY_WASM_FILES = ["ghostty-vt.wasm", "ghostty-write-pty.wasm"] as const;

/** This package's wasm folder. Only valid where this file runs from source, not from a bundle. */
export const GHOSTTY_VENDOR_DIR = NodeURL.fileURLToPath(new URL("../vendor", import.meta.url));

/** Instantiates libghostty-vt from a folder that holds `GHOSTTY_WASM_FILES`. */
export async function loadGhosttyRuntimeFrom(dir: string): Promise<GhosttyRuntime> {
  const [wasm, writePtyWasm] = await Promise.all(
    GHOSTTY_WASM_FILES.map((file) =>
      NodeFSP.readFile(NodePath.join(dir, file)).catch((cause: unknown) => {
        throw new Error(`libghostty-vt wasm is missing from ${dir}`, { cause });
      }),
    ),
  );
  // Copies: a small file's Buffer may be a view into Node's shared pool.
  return GhosttyRuntime.instantiate(new Uint8Array(wasm!), new Uint8Array(writePtyWasm!));
}
