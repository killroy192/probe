import type { GhosttyRuntime } from "./runtime.ts";

const SUCCESS = 0;
const FORMAT = { plain: 0, vt: 1 } as const;
const ACTIVE_SCREEN = 6;
const ALTERNATE_SCREEN = 1;
// Only pixel-size reports read these; a headless terminal has no cells to measure.
const CELL_WIDTH_PX = 8;
const CELL_HEIGHT_PX = 16;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** A libghostty-vt terminal with no renderer: it parses output and formats its state. */
export class GhosttyVtTerminal {
  private readonly runtime: GhosttyRuntime;
  private readonly terminal: number;
  private disposed = false;

  private constructor(runtime: GhosttyRuntime, terminal: number) {
    this.runtime = runtime;
    this.terminal = terminal;
  }

  static create(
    runtime: GhosttyRuntime,
    cols: number,
    rows: number,
    maxScrollbackBytes: number,
  ): GhosttyVtTerminal {
    const optionsSize = runtime.layout("GhosttyTerminalOptions").size;
    const options = runtime.alloc(optionsSize);
    const slot = runtime.allocOpaque();
    try {
      runtime.setField(options, "GhosttyTerminalOptions", "cols", cols);
      runtime.setField(options, "GhosttyTerminalOptions", "rows", rows);
      runtime.setField(options, "GhosttyTerminalOptions", "max_scrollback", maxScrollbackBytes);
      check("ghostty_terminal_new", runtime.call("ghostty_terminal_new", 0, slot, options));
      return new GhosttyVtTerminal(runtime, runtime.readPointer(slot));
    } finally {
      runtime.free(options, optionsSize);
      runtime.freeOpaque(slot);
    }
  }

  write(data: string): void {
    this.ensureActive();
    const bytes = encoder.encode(data);
    if (bytes.length === 0) return;
    const pointer = this.runtime.alloc(bytes.length);
    try {
      this.runtime.bytes(pointer, bytes.length).set(bytes);
      this.runtime.call("ghostty_terminal_vt_write", this.terminal, pointer, bytes.length);
    } finally {
      this.runtime.free(pointer, bytes.length);
    }
  }

  resize(cols: number, rows: number): void {
    this.ensureActive();
    check(
      "ghostty_terminal_resize",
      this.runtime.call(
        "ghostty_terminal_resize",
        this.terminal,
        cols,
        rows,
        CELL_WIDTH_PX,
        CELL_HEIGHT_PX,
      ),
    );
  }

  /**
   * The screen and scrollback, as text (`plain`) or as VT that rebuilds them in a fresh terminal of
   * the same size (`vt`): styles, modes, the cursor, scroll region and charsets included.
   */
  format(emit: keyof typeof FORMAT): string {
    this.ensureActive();
    const runtime = this.runtime;
    const optionsSize = runtime.layout("GhosttyFormatterTerminalOptions").size;
    const extra = runtime.layout("GhosttyFormatterTerminalOptions").fields.extra!.offset;
    const screen = extra + runtime.layout("GhosttyFormatterTerminalExtra").fields.screen!.offset;
    const options = runtime.alloc(optionsSize);
    const slot = runtime.allocOpaque();
    const out = runtime.alloc(8);
    let formatter = 0;
    try {
      runtime.setField(options, "GhosttyFormatterTerminalOptions", "size", optionsSize);
      runtime.setField(options, "GhosttyFormatterTerminalOptions", "emit", FORMAT[emit]);
      if (emit === "vt") {
        const terminalExtra = options + extra;
        runtime.setField(
          terminalExtra,
          "GhosttyFormatterTerminalExtra",
          "size",
          runtime.layout("GhosttyFormatterTerminalExtra").size,
        );
        // Not tabstops: the formatter sets them after the cursor, with moves that leave it elsewhere.
        for (const field of ["palette", "modes", "scrolling_region", "pwd", "keyboard"]) {
          runtime.setField(terminalExtra, "GhosttyFormatterTerminalExtra", field, 1);
        }
        const screenExtra = options + screen;
        runtime.setField(
          screenExtra,
          "GhosttyFormatterScreenExtra",
          "size",
          runtime.layout("GhosttyFormatterScreenExtra").size,
        );
        for (const field of [
          "cursor",
          "style",
          "hyperlink",
          "protection",
          "kitty_keyboard",
          "charsets",
        ]) {
          runtime.setField(screenExtra, "GhosttyFormatterScreenExtra", field, 1);
        }
      }
      check(
        "ghostty_formatter_terminal_new",
        runtime.call("ghostty_formatter_terminal_new", 0, slot, this.terminal, options),
      );
      formatter = runtime.readPointer(slot);
      check(
        "ghostty_formatter_format_alloc",
        runtime.call("ghostty_formatter_format_alloc", formatter, 0, out, out + 4),
      );
      const pointer = runtime.readPointer(out);
      const length = runtime.readPointer(out + 4);
      if (pointer === 0) return "";
      // Decode before freeing: the bytes are a view into wasm memory.
      const text = decoder.decode(runtime.bytes(pointer, length));
      runtime.call("ghostty_free", 0, pointer, length);
      return text;
    } finally {
      if (formatter !== 0) runtime.call("ghostty_formatter_free", formatter);
      runtime.free(out, 8);
      runtime.freeOpaque(slot);
      runtime.free(options, optionsSize);
    }
  }

  /** Whether a DEC private mode (such as 1 for app cursor keys, 2004 for bracketed paste) is on. */
  mode(decMode: number): boolean {
    this.ensureActive();
    const out = this.runtime.alloc(1);
    try {
      return (
        this.runtime.call("ghostty_terminal_mode_get", this.terminal, decMode, out) === SUCCESS &&
        this.runtime.bytes(out, 1)[0] !== 0
      );
    } finally {
      this.runtime.free(out, 1);
    }
  }

  isAlternateScreen(): boolean {
    this.ensureActive();
    const out = this.runtime.alloc(4);
    try {
      return (
        this.runtime.call("ghostty_terminal_get", this.terminal, ACTIVE_SCREEN, out) === SUCCESS &&
        this.runtime.view(out, 4).getUint32(0, true) === ALTERNATE_SCREEN
      );
    } finally {
      this.runtime.free(out, 4);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.runtime.call("ghostty_terminal_free", this.terminal);
  }

  private ensureActive(): void {
    if (this.disposed) throw new Error("The Ghostty terminal was disposed");
  }
}

function check(name: string, result: number): void {
  if (result !== SUCCESS) throw new Error(`${name} failed with ${result}`);
}
