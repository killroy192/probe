/** A scenario's assertion that failed, as `<what>: expected <e>, found <f>`. */
export class ExpectationError extends Error {
  readonly what: string;
  readonly expected: string;
  readonly found: string;

  constructor(what: string, expected: string, found: string) {
    super(`${what}: expected ${expected}, found ${found}`);
    this.name = "ExpectationError";
    this.what = what;
    this.expected = expected;
    this.found = found;
  }
}

const shown = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value));

/** Fails with an `ExpectationError` unless `found` equals `expected`, compared as shown. */
export function expected(spec: {
  readonly what: string;
  readonly expected: unknown;
  readonly found: unknown;
}): void {
  const want = shown(spec.expected);
  const got = shown(spec.found);
  if (want !== got) throw new ExpectationError(spec.what, want, got);
}

/** Fails unless `found` holds `part` (starts with it with `atStart`), naming the text found. */
export function expectText(
  what: string,
  found: string | null,
  part: string,
  { atStart = false }: { readonly atStart?: boolean } = {},
) {
  const want = `text ${atStart ? "starting with" : "containing"} "${part}"`;
  const holds = found !== null && (atStart ? found.startsWith(part) : found.includes(part));
  expected({ what, expected: want, found: holds ? want : (found ?? "no text") });
}
