# Probe

Probe is a terminal-first workspace for running many CLI coding agents side by side: workspaces of
projects, a tree of shells grouped by project and worktree, agent CLIs (Claude Code first) running
in server-owned terminals, and, next, live agent status. It is a fork of T3 Code that does not sync
upstream. The old chat UI is hidden and is removed in slices later; do not build on it. Product and
scope decisions, and the phase order, are in [docs/dev/roadmap.md](docs/dev/roadmap.md).

- **Docs describe what exists**, except `docs/dev/`, which holds tickets and notes for work that is
  planned or in flight. Where each kind of file goes: [Documentation](#documentation).
- **Tickets** are `PRB.E-NNN` epics and `PRB.T-NNN` tasks in `docs/dev/epics/` and `docs/dev/tasks/`.
  Change them only with `vp run tm` via the [tickets](.agents/skills/tickets/SKILL.md) skill; never
  hand-edit frontmatter or `ids.json`. Reference ticket IDs (e.g. `PRB.T-004`) in commits and PRs.
- Search code and `docs` with the `cocoindex-code` MCP when it helps; the index is gitignored.

## What Probe never compromises on

### 1. Open at the core

The roadmap, the reasoning and the code are public. Other products can be studied for how they
behave, but never copy code from a product whose license does not allow it.

### 2. Performance without compromise

Users run ten or more agents at once and notice a dropped frame, a lying spinner and a stale label.
Watch what crosses the websocket (terminal output is the big stream), what repaints, and what one
more shell costs the server. Make sure every change is considerate of performance impact.

### 3. Remote ready

The server owns every shell and the browser is a client over the websocket layer, so a shell keeps
running with no client attached and across server restarts. Clients connect locally, over the local
network or Tailscale, or through the inherited T3 Connect tunnel. Keep new features working when the
client is on another machine than the server.

### 4. Surfaces, in order

**Browser first**: the locally served `apps/web` is the product for now, and every feature must work
there. **Desktop** (Electron, wraps the web app) is built and verified only after the browser
functionality is done. **Mobile** is frozen: build nothing for it, but it must still compile after
contract changes. The UI is **mouse-first**: every action works with a mouse or touchpad; keyboard
shortcuts are optional extras, never the only path.

## A small glossary

Shared vocabulary is in [docs/internals/glossary.md](docs/internals/glossary.md).

## Documentation

Pick the place by asking: is it shipped, is it shared, is it durable?

| Where                       | Holds                                                                                         | Committed     | Never here                                                     |
| --------------------------- | --------------------------------------------------------------------------------------------- | ------------- | -------------------------------------------------------------- |
| `docs/user/`                | How to use shipped features                                                                   | yes           | implementation, plans                                          |
| `docs/operations/`          | Maintainer procedures: dev setup, release, debugging                                          | yes           | user how-tos, plans                                            |
| `docs/internals/`           | Architecture decisions, cross-component constraints and traps, for built code                 | yes           | anything not built yet                                         |
| `docs/dev/roadmap.md`       | Every settled product and scope decision, and the phase order                                 | yes           | per-ticket detail                                              |
| `docs/dev/questions.md`     | Open questions and unverified claims that span tickets                                        | yes           | copies of a ticket's assumption table                          |
| `docs/dev/epics/`, `tasks/` | One ticket each: spec, assumptions, verification notes, and the handoff a later session needs | yes, via `tm` | step-by-step working plans                                     |
| `docs/dev/design/`          | Design drafts for features not built yet                                                      | yes           |                                                                |
| `docs/dev/research/`        | Studies of other products and spike reports                                                   | yes           |                                                                |
| `docs/dev/ideas/`           | Unscoped ideas to research later, one file each                                               | yes           | decisions, tickets                                             |
| `.plans/`                   | The current working plan                                                                      | no            | anything a later session needs; put it in the ticket's handoff |
| Agent auto-memory           | How this developer likes to work with the agent                                               | no            | project facts and decisions                                    |

- **Memory test.** If another developer or agent on another machine would need it, it goes in
  `docs/dev`, not in your auto-memory. Do not commit auto-memory, plans, or other agent scratch files.
- **When a ticket lands.** `vp run tm mv <ID> done`, then move what still matters out of the ticket:
  architecture to `docs/internals/`, procedures to `docs/operations/`, usage to `docs/user/`. Product
  decisions stay in `roadmap.md`; delete the ticket's rows from `questions.md`. The merged PR is the
  implementation record.
- **Update docs in the same PR that changes behavior.** Rewrite or delete inherited T3 docs about
  features you remove (chat, web mode). When a documented decision or constraint changes, rewrite or
  remove the affected text; do not append another account of the new behavior.

Most code changes do not need an internal documentation change. Agents can read the code.

- `docs/internals/`: before adding a paragraph, ask what a maintainer would get wrong without it. If reading the relevant code answers the question, leave it out. A new page needs a distinct, durable reason to exist.
- Do not document every feature, enumerate fields or methods, narrate control flow, maintain file catalogs, or append PR summaries. Types, tests, and code already record the implementation. The glossary defines shared vocabulary; it is not a feature index.
- A local reason the code can't show goes in a short nearby code comment. Use an internal doc when the reasoning crosses boundaries or needs context the code cannot carry well. Link to the relevant source instead of copying it.
- `docs/user/`: give each major feature a concise section explaining what it does, how to start, and anything unintuitive. A settings path is useful; descriptions of visible buttons, icons, layouts, animations, or every UI state are not. Write in the shipped product's voice, without implementation details or contributor tooling. A UI tweak does not need a documentation entry, and a new control does not need its own page.
- `docs/operations/` is for maintainers. Instructions for operating an installed server belong in the user guides.

## The three ways to hurt yourself

1. **Killing by pattern.** Never `pkill -f`, `pgrep | kill`, or `kill` a PID you found by matching a name, path, or worktree string. Your own agent process has this worktree's path in its argv, and this machine runs several other dev servers at once. Kill only a PID you captured at spawn, or the owner of your port from `ss -H -ltnp` after confirming `/proc/<pid>/cwd` is your worktree.
2. **Writing to the live install.** `~/.t3/userdata` is the developer's real T3 Code database, in use while you work. Reading it and copying from it are fine, and a good way to get real test data (see Test data). Never start a server against it, never open it read-write, never clean it up. The same goes for agent CLIs' global config (`~/.claude/settings.json` and the like): Probe never edits it, and neither do your experiments; pass a throwaway file with `--settings` instead.
3. **Baking in origins.** Never set `VITE_HTTP_URL` or `VITE_WS_URL` for dev. Dev is single-origin and Vite proxies `/api`, `/ws`, `/oauth`, and `/.well-known`. Setting them bakes localhost into the bundle and silently breaks every remote browser.

## Working in the devcontainer

You (the agent, whichever harness) run inside the dev container, so mistakes stay off the developer's
machine. The checkout is at `/workspaces/<folder>`. Setup: [Dev container](docs/operations/development.md#dev-container).

- Run commands directly; git, `gh`, `vp` and the network all work. Hooks run here only: the host's
  `.git/config` sets `core.hooksPath=/dev/null`, and the container's own git config turns them on.
- `.devcontainer/` and the git config are read-only here; changes to them are the developer's, on the
  host.
- Worktrees are created and removed only on the host, with `.devcontainer/worktree.sh`; you cannot see
  the folders next to the checkout. Ask the developer when you need one.
- Never run `git worktree prune` here. This container cannot see the other worktrees, so git takes
  them for deleted, and a prune would drop their metadata.
- Never change hooks without explicit approval: git hooks (`.vite-hooks/`, `core.hooksPath`, the
  `staged` config in `vite.config.ts`) and Claude hooks (`.claude/hooks/`, `hooks` in
  `.claude/settings*.json`).
- Never pass `--host` to the dev runner: a relay binds the container's address for the published
  ports.

## Hit every surface

The most common defect in this repo is a change that works on the path you tested and is missing everywhere else. Before calling frontend work done, walk this list and say which entries applied:

- **Entry points.** Shell actions are reachable from the tree (row hover actions), the "+" modal, the tab strip, the "Workspaces" menu and Settings, and from inside a shell through the `probe` command. Fixing one is not fixing the feature. Chat entry points stay hidden.
- **Clients.** The browser is the target. Desktop wraps it and must not break; mobile must still compile. Shared client logic lives in `packages/client-runtime`.
- **Agent CLIs.** Agent status comes from a per-CLI adapter (Claude Code first); every other CLI runs as a plain terminal. Say per CLI what a change does, even if it is "plain terminal here". The chat-era provider adapters (Codex, Claude, Cursor, Grok, OpenCode, Antigravity) are frozen until chat is removed; do not extend them.
- **Shells.** zsh and bash start through Probe's wrapper startup files; fish and others are not wrapped. Process handling differs between Linux and macOS (see [Terminal runtime](docs/internals/terminal-runtime.md)).
- **Agents.** A capability a user can trigger is usually one an agent should reach too, through the `probe` command in its shell or MCP tools. That only works when it is a service method, not handler code.
- **Contracts.** Anything crossing the wire is typed in `packages/contracts`. Change the schema and the server, web, mobile, and desktop all follow.
- **Reverse states.** If you added a way in, add the way out and the way to see it. Close needs reopen; kill needs a way to see what ended; an ended shell needs Restore or remove. A one-way door is a bug.
- **Lifetimes.** Shells outlive the browser tab, the server process and the client. Check a change after a reload, a server restart, and with a second client connected.
- **Connection modes.** Local, remote/relay, and tunnel behave differently. Multi-device and multi-environment cases are real. The UI may run on a different machine than the server ([roadmap](docs/dev/roadmap.md) decision 10): never assume the UI can read the server's files, run its commands or reach its loopback.
- **Docs.** Check whether the change makes existing guidance inaccurate. Apply the [documentation rules](#documentation) before adding anything.

## Dev servers

- `vp i` installs. The container runs it when it is created; after a lockfile change, run it yourself. Never install on the host.
- `vp run dev` starts server and web. In a worktree, state defaults to that worktree's gitignored `.t3`, which deliberately outranks an ambient `T3CODE_HOME` so you cannot land on shared state by accident. An explicit `--home-dir` still wins.
- Ports derive from the worktree path and are stable across restarts, but read the real ones from the `[dev-runner]` line since occupied ports shift.
- Sharing over the tailnet is three steps: run `vp run dev --share` in the background, wait for the `pairingUrl:` line in its output, then give that full URL to an unpaired browser. Do not wire up `tailscale serve` by hand, open the URL yourself, or consume the user's pairing link. A browser with the reusable dev cookie can use the bare origin. If a normal one-time token was consumed, mint a fresh one with `node apps/server/src/bin.ts pair`. It carries standard scopes, while the startup URL carries admin scopes needed for Connections settings.
- To reuse web dev auth across worktrees, configure one fixed `T3CODE_DEV_AUTH_TOKEN` in the main checkout's gitignored `.env` and copy that file into each worktree (a copy, not a symlink: the container cannot follow a link to a host path). Never commit or publish the token or a startup URL. See [Reusable dev credential](docs/operations/development.md#reusable-dev-credential).
- Stop what you started, by the PID you tracked. See rule 1.
- Need a second checkout? Ask the developer for a worktree (`.devcontainer/worktree.sh`); it opens in
  its own container. Steps: [Worktrees](docs/operations/development.md#worktrees).

## Test data

Probe's own state (saved workspaces in `userdata/workspaces`, the shell host and its shells) starts empty in a worktree's `.t3`; the scenario harness builds its own on a throwaway home. The seeding below copies chat-era data, which only matters when you touch code that still reads it.

An empty database is a bad test. Seed your worktree's `.t3` with a copy of real data instead of pointing at live state:

- The first `vp run dev` in a worktree does this for you when its database is missing and the source is at most 500 MiB. Larger sources warn and dev starts with an empty database. `--no-seed` or `T3CODE_DEV_SEED=0` skips seeding. Manual migration still accepts larger sources and may use substantial disk space before pruning.
- Run `vp run migrate-dev-db` with your dev server stopped to refresh. It rebuilds `<worktree>/.t3/userdata/statev2.sqlite` from a read-only snapshot of `~/.t3/userdata/statev2.sqlite`, the developer's real data. It keeps recent projects and their stopped threads, and drops scheduled tasks, pending work, and auth sessions, so your dev server never runs the developer's agents. Raise `--projects` and `--threads-per-project` for more data.
- Refresh `statev2.sqlite`, not `state.sqlite`. The server copies the V1 `state.sqlite` only when `statev2.sqlite` is missing.
- Bring `secrets` and `settings.json` only if the flow under test needs them.
- Copy in, never symlink. Data flows one way: into your sandbox, never back out.

## Verifying

- Before you push, run `vp run check:changed`. It runs CI's fast checks for changed files: format, lint, knip, typecheck of affected packages and dependents, tests beside changes, and the cross-file checks those miss. CI still runs the full test suites.
- While you iterate, run `vp test run <files>`. For big files, add `-t "<name>"`.
- Use `vp run typecheck`, not `npx tsc`; it caches per package. Both run tsc-rs (`typescript` is the `@tsc-rs/typescript` drop-in).
- Run `node -e` snippets from `apps/server` or the owning package. `effect` does not resolve from the repo root.
- Test behavior that can break, such as orchestration and event-sourcing, provider protocol translation, auth and permission guards, persistence and migrations, external-format parsing, race fixes, and the logic a bug fix changed. Leave out tests for what types already guarantee, trivial logic, copy text, smoke runs, mock-call mirrors, callback wiring, and props rendered to static markup.
- Extend before you add. When an existing test or table covers the behavior, add a row or an assertion there. Write a new `it` only when no case fits.
- Test at one layer: the lowest one that fails on `main`. Do not repeat the case in a wrapper test, at each call site, or in web and mobile copies of the same logic.
- [Testing](docs/internals/testing.md) carries these same test rules, plus review guidance, for reviewers. Change both together.
- **Do not run repo-wide checks.** No `vp check`, no `vp run -r test`, no `vp run -r typecheck` unless I ask. CI owns the full suite.
- Backend behavior changes ship with focused tests for that behavior.
- Proof for a bug fix depends on the bug. Logic, data, state, and protocol bugs get a failing test first (the fewest that fail on `main` for that reason, in an existing case of the module's test file where one fits), then the fix. Purely visual bugs (spacing, colour, alignment, a layout shift) get before/after captures as their proof and no test: do not add UI tests for nitpicks, and do not ask for one in review when a capture already shows it. A server-only fix with no visible surface ships the test plus a short runtime transcript.
- The server is event-sourced, and side effects run after the command commits. In tests, drain the effect worker (`OrchestrationEffectWorkerV2.drain`) or await the specific persisted event or `Deferred` that marks the milestone. Never wait on sleeps or polling. A test that needs a timeout to pass is wrong. Concretely:
  - `it.effect` runs on a `TestClock`; `Effect.sleep` only advances through `TestClock.adjust`. `it.live` is wall-clock and only for subprocess or network fixtures.
  - No `yieldNow` or `sleep` polling loops. Await the `Deferred`, take from the `Queue`, or drain the worker.
  - No per-test timeout argument or `retry`. The project timeout is the ceiling, and flaky tests are fixed, not retried.
  - No `performance.now()` or `Date.now()` deltas. Assert on events and counts, not elapsed time.
  - Browser tests assert through `expect.element` or `vi.waitFor`, never `requestAnimationFrame` or `transitionend`.
  - `vi.mock` factories must not spread a real module that pulls in Shiki or the diff workers.
  - `it.skip` and friends need a tracking issue on the line above: `// quarantine: #1234 <why>`.
  - Lint enforces this: `t3code/no-test-timeout-or-unreasoned-skip`, `t3code/no-frame-waits-in-browser-tests`, `t3code/no-wall-clock-in-tests`, `t3code/no-real-time-wait-in-tests`, `t3code/no-polling-loop-in-tests`.
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

- Terminal-first behavior is proven by the scenario harness: `vp run test:scenarios` (or `-- --only <id>`) starts Probe on a throwaway home and drives it in headless Chromium, with the mock agent CLI (`scripts/mock-agent/mock-agent.ts`) standing in for Claude Code. A new user-facing behavior adds or extends a scenario. See [Scenario tests](docs/operations/development.md#scenario-tests).
- User-visible frontend changes should get one integrated pass in a real client with `test-t3-app`. The primary agent does this once after integrating. Subagents do not launch their own dev servers.

- Real agent runs cost money. Use the mock agent in shells. Run a real CLI (Claude Code in a shell) only when the change depends on its behavior, and then pick its cheapest model, such as Haiku. The `Replay (dev)` provider that `vp run dev` registers only matters for chat code; [test-t3-app](.agents/skills/test-t3-app/SKILL.md) shows how to start one.

Mobile is frozen, so you rarely need a device. When a change does touch mobile, a missing or outdated native client is an install step, not a blocker. a missing or outdated native client is an install step, not a blocker. Run `vp run mobile:install <ios|android> [device-id]` on the device host before starting Metro; it targets the only booted simulator or connected Android device when the id is omitted. It installs the dev client for this checkout's native fingerprint from the shared cache in seconds and builds only when no machine has built it yet, so prefer it over `expo run:*`, `xcodebuild`, or `gradlew`, which rebuild from scratch. Its stdout is one JSON line; build output goes to the log it names. See `test-t3-mobile` for the full workflow.

## Evals

`evals/` checks how real models behave with T3 Code's model-facing text: agent instructions, MCP tool descriptions and schemas, and generated titles. Before you change that text, read [evals/README.md](evals/README.md) and run the evals it names. When you fix a model behavior bug, add a case that fails before the fix.

## How it works

Probe's path: clients send typed WebSocket requests (`workspace.*`, `shell.*`) to services in `apps/server`. A workspace is saved as one file in `userdata/workspaces`. `Shells` (`apps/server/src/terminal/Shells.ts`) owns standalone shells on top of the terminal manager; a detached **shell host**, one per server state folder, owns their PTYs so shells keep running while the server is stopped and the next server reattaches. The server types an agent command into a shell once its wrapper startup files report the first prompt. Details: [Terminal runtime](docs/internals/terminal-runtime.md).

The chat path below is hidden and frozen until it is removed; touch it only to keep the app running.

Clients send typed WebSocket requests. The server turns them into _commands_. The _orchestrator_ (`apps/server/src/orchestration-v2/Orchestrator.ts`) serializes commands and decides _events_ without doing any I/O. The _event sink_ commits those events, the _projections_ the UI reads, the _command receipt_, and _outbox_ effects in one transaction. The _effect worker_ then runs the effects, such as starting a provider turn or capturing a checkpoint, and feeds results back as commands. Provider CLIs run as subprocesses; per-provider _adapters_ translate their native protocols into orchestration events. Each turn ends with a _checkpoint_, a hidden git ref, so the app can diff and restore.

Architecture and its constraints: `docs/internals/overview.md`. Glossary: `docs/internals/glossary.md`

## Where code lives

- `apps/server/src/terminal` - shells, the shell host, wrapper startup files, process trees. `apps/server/src/savedWorkspaces` saves workspaces; the `shell.*` and workspace contracts are in `packages/contracts/src`.
- `apps/web/src/components/workspaces` - the terminal-first screen: start screen, sidebar tree, "+" modal, tabs.
- `scripts/scenarios` - the scenario harness; `scripts/mock-agent` - the mock agent CLI.
- `docs/dev` - roadmap, open questions, tickets, design drafts and research.
- `apps/server` - WebSocket, orchestration, providers, checkpointing. Effect-heavy: read [Effect services](docs/internals/effect-services.md) before adding server code, and `.repos/effect-smol/LLMS.md` for the Effect library itself.
- `apps/web` - React/Vite UI. `apps/desktop` wraps it, `apps/mobile` is React Native (frozen), `apps/marketing` is the T3 site, to be removed.
- `packages/contracts` - Effect/Schema contracts plus small derived helpers. No heavy runtime logic.
- `packages/shared` - shared runtime utils, subpath exports, no barrel.
- `packages/client-runtime` - client code shared by web and mobile.
- `.repos/` - vendored read-only references. Prefer their patterns over invented ones. Never edit or import from them. Sync with `vpr sync:repos` when bumping the matching dependency. If it is missing (sparse checkout), read a file with `git show origin/main:.repos/<path>`.

## Taste

- Complexity belongs at the adapter boundary. Orchestration stays pure, UI stays dumb.
- Client mutations use `createEnvironmentRpcCommand`. Add protected methods to `CLIENT_GUARDED_RPC_SCOPES` in contracts and use the command's `permissionAtom` for UI availability. Grants are checked at execution against the destination environment; the server remains authoritative. Keep raw RPC clients inside `rpc/`, and extend the permission behavior tests when adding a protected method.
- Server features are services; transports stay thin. A `ws.ts` RPC handler, HTTP route, or MCP tool decodes input, calls one service method, and maps errors. See [Effect services](docs/internals/effect-services.md).
- `apps/web/src/components/ui` exports own their look. Pick a `variant` or `size`; do not restyle one with `className`. If none fits and the look is a generic concept, add a variant to the component; a look that belongs to one feature stays in that feature's own component, not in `components/ui`. Layout classes (width, flex, margin, position) belong on the parent. `shadcn/no-restyle` fails lint on violations. See [Web UI](docs/internals/web-ui.md).
- Reusable Effect functions use `Effect.fn("Service.operation")` with a stable span name, not a
  function wrapping `Effect.gen`. Keep `Effect.gen` for inline programs and layer construction.
  Use `Effect.fnUntraced` only when spans would be too frequent (stream chunks, per-event
  projection, tight loops) or duplicate an existing tracing boundary; explain that choice nearby.
  Named `Effect.fn` creates a span; the unnamed form does not. Preserve existing span names and
  options, and pass combinators as additional function-builder arguments.
- Inferred types over annotations. `any` is the enemy.
- Default to no comment. Write one only for a constraint, an external quirk, or an invariant the code can't show, in one line where you can and four at most. Don't restate names or signatures, narrate steps, record history, or explain the fix you just made; the PR carries that. `t3code/no-low-value-comments` enforces the length cap and the mechanical cases.
- React effects are for synchronizing with something outside React. Derive in render and act in handlers instead of syncing state, but don't hide real lifecycle work in refs or stores to dodge one. The `t3code/no-unreasoned-state-sync` lint rule reports every effect; one that stays states its reason with `// oxlint-disable-next-line t3code/no-unreasoned-state-sync -- <why>`.
- Our users drive agents all day and notice a dropped frame, a lying spinner, and a stale label. No continuously repainting animations; they peg the GPU on high-refresh displays.
- If a rule here fights the task in front of you, say so loudly and get a human sign-off before breaking it.

## Additional tips

- Security is important, but should not be over-indexed on, especially for dev mode/maintainer-only features.
