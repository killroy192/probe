import ghosttyWasmUrl from "@t3tools/ghostty-vt/ghostty-vt.wasm?url";
import ghosttyWritePtyWasmUrl from "@t3tools/ghostty-vt/ghostty-write-pty.wasm?url&no-inline";
import { GhosttyRuntime } from "@t3tools/ghostty-vt/runtime";

export { GhosttyRuntime };

async function fetchWasm(url: string, what: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to load ${what} (${response.status})`);
  return response.arrayBuffer();
}

let runtimePromise: Promise<GhosttyRuntime> | null = null;

export function loadGhosttyRuntime(): Promise<GhosttyRuntime> {
  runtimePromise ??= Promise.all([
    fetchWasm(ghosttyWasmUrl, "libghostty-vt"),
    fetchWasm(ghosttyWritePtyWasmUrl, "the libghostty-vt PTY trampoline"),
  ])
    .then(([wasm, writePtyWasm]) => GhosttyRuntime.instantiate(wasm, writePtyWasm))
    .catch((error) => {
      runtimePromise = null;
      throw error;
    });
  return runtimePromise;
}
