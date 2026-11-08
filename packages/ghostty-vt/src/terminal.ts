import type { GhosttyRuntime } from "./runtime.ts";

const SUCCESS = 0;
const FORMAT = { plain: 0, vt: 1 } as const;
const CURSOR_X = 3;
const CURSOR_Y = 4;
const CURSOR_PENDING_WRAP = 5;
const ACTIVE_SCREEN = 6;
const POINT_ACTIVE = 0;
const ALTERNATE_SCREEN = 1;
// Only pixel-size reports read these; a headless terminal has no cells to measure.
const CELL_WIDTH_PX = 8;
const CELL_HEIGHT_PX = 16;

interface Extras {
  readonly terminal: ReadonlyArray<string>;
  readonly screen: ReadonlyArray<string>;
}
const NO_EXTRAS: Extras = { terminal: [], screen: [] };
const ALL_EXTRAS: Extras = {
  terminal: ["palette", "modes", "scrolling_region", "tabstops", "pwd", "keyboard"],
  screen: ["cursor", "style", "hyperlink", "protection", "kitty_keyboard", "charsets"],
};
const PEN_STYLE: Extras = { terminal: [], screen: ["style"] };

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
   * the same size (`vt`): styles, modes, the cursor, scroll region, tab stops and charsets included.
   */
  format(emit: keyof typeof FORMAT): string {
    this.ensureActive();
    if (emit === "plain") return this.runFormatter("plain", NO_EXTRAS);
    const screen = this.runFormatter("vt", ALL_EXTRAS);
    // The formatter places the cursor before its tab stops, whose moves leave the cursor elsewhere,
    // and a placed cursor loses a pending wrap. Place it again, after everything.
    const x = this.readData(CURSOR_X, 2);
    const y = this.readData(CURSOR_Y, 2);
    const place = `\x1b[${y + 1};${x + 1}H`;
    if (this.readData(CURSOR_PENDING_WRAP, 1) === 0) return screen + place;
    // Printing the last cell again leaves the cursor waiting to wrap; the pen style follows it.
    return screen + place + this.runFormatter("vt", PEN_STYLE, { x, y });
  }

  private runFormatter(
    emit: keyof typeof FORMAT,
    extras: Extras,
    cell?: { readonly x: number; readonly y: number },
  ): string {
    const runtime = this.runtime;
    const optionsLayout = runtime.layout("GhosttyFormatterTerminalOptions");
    const extra = optionsLayout.fields.extra!.offset;
    const screen = extra + runtime.layout("GhosttyFormatterTerminalExtra").fields.screen!.offset;
    const options = runtime.alloc(optionsLayout.size);
    const selection = cell === undefined ? 0 : this.cellSelection(cell.x, cell.y);
    const slot = runtime.allocOpaque();
    const out = runtime.alloc(8);
    let formatter = 0;
    try {
      runtime.setField(options, "GhosttyFormatterTerminalOptions", "size", optionsLayout.size);
      runtime.setField(options, "GhosttyFormatterTerminalOptions", "emit", FORMAT[emit]);
      // A wasm32 pointer; the runtime's field writer has no `opaque` type.
      runtime
        .view(options + optionsLayout.fields.selection!.offset, 4)
        .setUint32(0, selection, true);
      setFlags(runtime, options + extra, "GhosttyFormatterTerminalExtra", extras.terminal);
      setFlags(runtime, options + screen, "GhosttyFormatterScreenExtra", extras.screen);
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
      if (selection !== 0) runtime.free(selection, runtime.layout("GhosttySelection").size);
      runtime.free(options, optionsLayout.size);
    }
  }

  /** A selection of the one cell at (`x`, `y`) in the active area. */
  private cellSelection(x: number, y: number): number {
    const runtime = this.runtime;
    const pointLayout = runtime.layout("GhosttyPoint");
    const point = runtime.alloc(pointLayout.size);
    const selectionLayout = runtime.layout("GhosttySelection");
    const selection = runtime.alloc(selectionLayout.size);
    try {
      runtime.setField(point, "GhosttyPoint", "tag", POINT_ACTIVE);
      const value = runtime.view(
        point + pointLayout.fields.value!.offset,
        pointLayout.fields.value!.size,
      );
      value.setUint16(0, x, true);
      value.setUint32(4, y, true);
      runtime.setField(selection, "GhosttySelection", "size", selectionLayout.size);
      const gridRefSize = runtime.layout("GhosttyGridRef").size;
      for (const end of ["start", "end"] as const) {
        const ref = selection + selectionLayout.fields[end]!.offset;
        runtime.setField(ref, "GhosttyGridRef", "size", gridRefSize);
        check(
          "ghostty_terminal_grid_ref",
          runtime.call("ghostty_terminal_grid_ref", this.terminal, point, ref),
        );
      }
      return selection;
    } catch (error) {
      runtime.free(selection, selectionLayout.size);
      throw error;
    } finally {
      runtime.free(point, pointLayout.size);
    }
  }

  private readData(key: number, size: 1 | 2): number {
    const out = this.runtime.alloc(size);
    try {
      check(
        "ghostty_terminal_get",
        this.runtime.call("ghostty_terminal_get", this.terminal, key, out),
      );
      return size === 1
        ? this.runtime.bytes(out, 1)[0]!
        : this.runtime.view(out, 2).getUint16(0, true);
    } finally {
      this.runtime.free(out, size);
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

function setFlags(
  runtime: GhosttyRuntime,
  pointer: number,
  struct: "GhosttyFormatterTerminalExtra" | "GhosttyFormatterScreenExtra",
  fields: ReadonlyArray<string>,
): void {
  runtime.setField(pointer, struct, "size", runtime.layout(struct).size);
  for (const field of fields) runtime.setField(pointer, struct, field, 1);
}

function check(name: string, result: number): void {
  if (result !== SUCCESS) throw new Error(`${name} failed with ${result}`);
}
