# Testing

Rules for writing tests, and for asking for them in review. AGENTS.md carries the same writing rules under Verifying; change both together.

## What to test

- Test behavior that can break, such as orchestration and event-sourcing, provider protocol translation, auth and permission guards, persistence and migrations, external-format parsing, race fixes, and the logic a bug fix changed. Leave out tests for what types already guarantee, trivial logic, copy text, smoke runs, mock-call mirrors, callback wiring, and props rendered to static markup.
- Extend before you add. When an existing test or table covers the behavior, add a row or an assertion there. Write a new `it` only when no case fits.
- Test at one layer: the lowest one that fails on `main`. Do not repeat the case in a wrapper test, at each call site, or in web and mobile copies of the same logic.
- In review, ask for a missing test only when it would catch a real regression. Do not ask for one assertion per constant, label, or `switch` case. Flag a new test that breaks the rules above, and name the fix: fold it into the existing case or table, delete it, or keep one layer.
- Backend behavior changes ship with focused tests for that behavior.
- Proof for a bug fix depends on the bug. Logic, data, state, and protocol bugs get a failing test first (the fewest that fail on `main` for that reason, in an existing case of the module's test file where one fits), then the fix. Purely visual bugs (spacing, colour, alignment, a layout shift) get before/after captures as their proof and no test: do not add UI tests for nitpicks, and do not ask for one in review when a capture already shows it. A server-only fix with no visible surface ships the test plus a short runtime transcript.

## Waiting for work

- The server is event-sourced, and side effects run after the command commits. In tests, drain the effect worker (`OrchestrationEffectWorkerV2.drain`) or await the specific persisted event or `Deferred` that marks the milestone. Never wait on sleeps or polling. A test that needs a timeout to pass is wrong. Concretely:
  - `it.effect` runs on a `TestClock`; `Effect.sleep` only advances through `TestClock.adjust`. `it.live` is wall-clock and only for subprocess or network fixtures.
  - No `yieldNow` or `sleep` polling loops. Await the `Deferred`, take from the `Queue`, or drain the worker.
  - No per-test timeout argument or `retry`. The project timeout is the ceiling, and flaky tests are fixed, not retried.
  - No `performance.now()` or `Date.now()` deltas. Assert on events and counts, not elapsed time.
  - Browser tests assert through `expect.element` or `vi.waitFor`, never `requestAnimationFrame` or `transitionend`.
  - `vi.mock` factories must not spread a real module that pulls in Shiki or the diff workers.
  - `it.skip` and friends need a tracking issue on the line above: `// quarantine: #1234 <why>`.
  - Lint enforces this: `t3code/no-test-timeout-or-unreasoned-skip`, `t3code/no-frame-waits-in-browser-tests`, `t3code/no-wall-clock-in-tests`, `t3code/no-real-time-wait-in-tests`, `t3code/no-polling-loop-in-tests`.

## Scenario tests

Scenarios (`scripts/scenarios/`) prove the terminal-first product end to end in headless Chromium, installed and cached the same way as for the web browser tests. A Node runner owns the server process and uses Playwright as a library, because Vitest browser mode runs test code inside the page and cannot stop or restart a real server.

- Each scenario gets its own throwaway home, server and browser context. The server child never inherits `T3CODE_*` or `VITE_*`, and the runner refuses `~/.t3` or any server address. Never add a path to real data or a remote server.
- Scenarios receive a `PointerPage` (no `keyboard`). Drive the UI with clicks; typing into a terminal or text field is fine, keyboard shortcuts are not.
- Wait on events (a locator, a ready line, a process `exit`), never on sleeps. Fix flakiness instead of retrying.
- `harness.test.ts` covers the runner's failure paths; it needs the Playwright Chromium installed, like the web browser tests.
- A new scenario goes in `scenarios/` and replaces its `pending` entry in `registry.ts`. Self-tests of the harness live in `selftest/` and run only with `--selftest`.
- The mock agent (`scripts/mock-agent/mock-agent.ts`) stands in for a Claude-Code-like CLI in shells. The runner sets `PROBE_SEED_MOCK_AGENT`, so each throwaway state folder starts with a "mock agent" starting script; `openModal` picks it unless told otherwise, and the starting-script helpers in `workspaceUi.ts` rewrite the list file in the home, which the server reads on every use.
- Fault helpers: `server.restart({ env })` restarts with changed variables (a broken `GIT_CONFIG_GLOBAL`, or `PROBE_SEED_MOCK_AGENT: undefined` for a server without the default), `server.logs()` returns the server's info-level output, and `connectionCutter(page)` in `browser.ts` drops a page's websockets when it sends a given request. To end a shell from outside the app, kill the `pid` the shell list reports (S2 does this for AC-19). Shared waits (`recorder`, `pageFrames`, `gone`) are in `support.ts`.
- A failure message passed to `check()` is evaluated even when the check passes, so never `await` a locator inside it.

## Web browser tests

- Web browser tests are `*.browser.test.tsx` or `*.browser.test.ts` and render with `await using screen = await render(...)` from `apps/web/test/render.tsx`. `t3code/require-disposable-render` errors on the old patterns.
  - Acquire what the test drives after mounting (fake timers it advances, spies it sets up after mounting) after the render, so it disposes before the unmount. Anything the first render reads comes before it.
  - A helper that renders and then waits or clicks puts the screen in an `AsyncDisposableStack` and `move()`s it out only on success, so a failed wait still unmounts.
  - `rerender` needs a fresh element on every call.
  - No lifecycle hooks and no module-level mutable state. Shared mock state that `vi.mock` factories read is reset by a `setup()` call at the top of the test.
  - `router` is on by default. Pass `router: false` only with a one-line comment saying why.

  ```tsx
  it("saves on Enter", async () => {
    const onSave = vi.fn();
    using _now = vi.spyOn(Date, "now").mockReturnValue(0);
    await using screen = await render(<TitleEditor onSave={onSave} />, { router: "/threads/1" });
    await userEvent.type(screen.getByRole("textbox"), "Title{Enter}");
    expect(onSave).toHaveBeenCalledWith("Title");
  });
  ```
