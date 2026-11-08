import { GHOSTTY_VT_WASM_BASE64, GHOSTTY_WRITE_PTY_WASM_BASE64 } from "./embeddedWasm.generated.ts";
import { GhosttyRuntime } from "./runtime.ts";

// Embedded rather than read from vendor/, so a bundled or single-executable server has no file to
// ship and cannot run without it.
/** The two wasm files' bytes, decoded from their embedded copies. */
export function decodeEmbeddedWasm() {
  return {
    wasm: new Uint8Array(Buffer.from(GHOSTTY_VT_WASM_BASE64, "base64")),
    writePtyWasm: new Uint8Array(Buffer.from(GHOSTTY_WRITE_PTY_WASM_BASE64, "base64")),
  };
}

let runtimePromise: Promise<GhosttyRuntime> | null = null;

/** The process's one libghostty-vt runtime, instantiated on first use. */
export function loadGhosttyRuntime(): Promise<GhosttyRuntime> {
  runtimePromise ??= Promise.resolve()
    .then(() => {
      const { wasm, writePtyWasm } = decodeEmbeddedWasm();
      return GhosttyRuntime.instantiate(wasm, writePtyWasm);
    })
    .catch((error: unknown) => {
      runtimePromise = null;
      throw error;
    });
  return runtimePromise;
}
