import { describe, expect, it } from "vite-plus/test";

import { redact } from "./report.ts";

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
