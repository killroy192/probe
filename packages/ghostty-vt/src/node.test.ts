// @effect-diagnostics nodeBuiltinImport:off - Compares the embedded wasm with the vendored files.
import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { decodeEmbeddedWasm, loadGhosttyRuntime } from "./node.ts";

const vendored = (file: string) =>
  new Uint8Array(NodeFS.readFileSync(new URL(`../vendor/${file}`, import.meta.url)));

describe("loading libghostty-vt in Node", () => {
  // Fails when the wasm was rebuilt without regenerating src/embeddedWasm.generated.ts.
  it("embeds the vendored wasm files byte for byte", () => {
    const embedded = decodeEmbeddedWasm();
    expect(embedded.wasm).toEqual(vendored("ghostty-vt.wasm"));
    expect(embedded.writePtyWasm).toEqual(vendored("ghostty-write-pty.wasm"));
  });

  it("instantiates the embedded runtime once and runs a terminal", async () => {
    const runtime = await loadGhosttyRuntime();
    expect(await loadGhosttyRuntime()).toBe(runtime);
    const optionsSize = runtime.layout("GhosttyTerminalOptions").size;
    const options = runtime.alloc(optionsSize);
    runtime.setField(options, "GhosttyTerminalOptions", "cols", 20);
    runtime.setField(options, "GhosttyTerminalOptions", "rows", 4);
    const slot = runtime.allocOpaque();
    expect(runtime.call("ghostty_terminal_new", 0, slot, options)).toBe(0);
    runtime.free(options, optionsSize);
    const terminal = runtime.readPointer(slot);
    const text = new TextEncoder().encode("hi");
    const pointer = runtime.alloc(text.length);
    runtime.bytes(pointer, text.length).set(text);
    runtime.call("ghostty_terminal_vt_write", terminal, pointer, text.length);
    runtime.free(pointer, text.length);
    runtime.call("ghostty_terminal_free", terminal);
    runtime.freeOpaque(slot);
  });
});
