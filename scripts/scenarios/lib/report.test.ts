import { describe, expect, it } from "vite-plus/test";

import { lineRedactor, redact } from "./report.ts";

describe("redact", () => {
  it.each([
    [
      "ws://127.0.0.1:4000/ws?wsTicket=abc.DEF-123&x=1",
      "ws://127.0.0.1:4000/ws?wsTicket=[redacted]&x=1",
    ],
    ["http://h/pair#token=s3cr3t", "http://h/pair#[redacted]"],
    ["GET /api?token=s3cr3t done", "GET /api?token=[redacted] done"],
    ["authorization: Bearer eyJhbGciOi.x.y", "authorization: Bearer [redacted]"],
    ['{"credential":"s3cr3t","name":"a"}', '{"credential":"[redacted]","name":"a"}'],
    ['{"sessionToken": "s3cr3t"}', '{"sessionToken": "[redacted]"}'],
    [
      "cookie: t3_session_4000_abc=s3cr3t; theme=dark",
      "cookie: t3_session_4000_abc=[redacted]; theme=[redacted]",
    ],
    [
      "Set-Cookie: t3_session=s3cr3t; Path=/; HttpOnly",
      "Set-Cookie: t3_session=[redacted]; Path=[redacted]; HttpOnly",
    ],
    ["sent t3_session_9=s3cr3t to the page", "sent t3_session_9=[redacted] to the page"],
  ])("masks %s", (input, masked) => {
    expect(redact(input)).toBe(masked);
    expect(redact(input)).not.toContain("s3cr3t");
  });

  it("leaves a log line without secrets alone", () => {
    const line = "2026-11-11T10:00:00.000Z DEBUG shell.open cwd=/tmp/x cols=80";
    expect(redact(line)).toBe(line);
  });
});

describe("lineRedactor", () => {
  it("masks a secret split across chunks, and passes on the last unfinished line at the end", () => {
    const out: Array<string> = [];
    const log = lineRedactor((text) => out.push(text));
    for (const chunk of [
      "pairingUrl: http://h/pa",
      "ir#token=s3c",
      "r3t\nready\nlast t3_sess",
      "ion=s3cr3t",
    ]) {
      log.write(chunk);
    }
    expect(out.join("")).toBe("pairingUrl: http://h/pair#[redacted]\nready\n");
    log.end();
    expect(out.join("")).toBe(
      "pairingUrl: http://h/pair#[redacted]\nready\nlast t3_session=[redacted]",
    );
  });
});
