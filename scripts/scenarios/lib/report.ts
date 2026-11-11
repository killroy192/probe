// @effect-diagnostics nodeBuiltinImport:off - Reads the process's user and prints to its stdout.

import * as NodeProcess from "node:process";

/**
 * Runs a check that relies on file permissions, or says why it is skipped: root ignores
 * permission bits, so the failure the check provokes would never happen and it would pass vacuously.
 */
export async function unlessRoot(
  scenarioId: string,
  what: string,
  run: () => Promise<void>,
): Promise<void> {
  if (NodeProcess.getuid?.() === 0) {
    NodeProcess.stdout.write(
      `SKIP    ${scenarioId} ${what}: running as root, which ignores file permissions\n`,
    );
    return;
  }
  await run();
}

const MASK = "[redacted]";
const SECRET_KEYS = "wsTicket|token|credential|secret|password";

/**
 * Masks what would let a reader of a failure's artifacts sign in: query and JSON credentials,
 * bearer tokens, pairing fragments and cookie values.
 */
export function redact(text: string): string {
  return text
    .replace(/(\/pair#)[^\s"'`<>]+/g, `$1${MASK}`)
    .replace(new RegExp(`((?:${SECRET_KEYS})=)[^\\s&#"'\`<>;,]+`, "gi"), `$1${MASK}`)
    .replace(new RegExp(`("(?:\\w*(?:${SECRET_KEYS}))"\\s*:\\s*")[^"]*`, "gi"), `$1${MASK}`)
    .replace(/(\bBearer\s+)[^\s"'`,;]+/gi, `$1${MASK}`)
    .replace(/(\bt3_session\w*=)[^\s;"'`,]+/g, `$1${MASK}`)
    .replace(
      /((?:set-)?cookie"?\s*[:=]\s*"?)([^\n"]*)/gi,
      (_, head: string, value: string) =>
        `${head}${value.replace(/([^=;\s]+=)[^;\s]*/g, `$1${MASK}`)}`,
    );
}

/**
 * Redacts a stream of output a line at a time, so a secret split across two chunks is still
 * masked: `write` passes on every whole line, `end` the rest.
 */
export function lineRedactor(out: (text: string) => void) {
  let pending = "";
  return {
    write: (chunk: string) => {
      pending += chunk;
      const cut = pending.lastIndexOf("\n") + 1;
      if (cut === 0) return;
      out(redact(pending.slice(0, cut)));
      pending = pending.slice(cut);
    },
    end: () => {
      if (pending !== "") out(redact(pending));
      pending = "";
    },
  };
}
