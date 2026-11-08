import { describe, expect, it } from "vite-plus/test";

import { GHOSTTY_VENDOR_DIR, loadGhosttyRuntimeFrom } from "./node.ts";

describe("loading libghostty-vt in Node", () => {
  it("instantiates from the package's wasm folder and runs a terminal", async () => {
    const runtime = await loadGhosttyRuntimeFrom(GHOSTTY_VENDOR_DIR);
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

  it("names the folder when the wasm files are not there", async () => {
    await expect(loadGhosttyRuntimeFrom("/nonexistent/ghostty-vt")).rejects.toThrow(
      "/nonexistent/ghostty-vt",
    );
  });
});
