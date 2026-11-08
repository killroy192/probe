# Probe docs

## Using Probe

- [Workspaces](./user/workspaces.md): workspaces, projects, shells, worktrees, restarts
- [Terminal history](./user/terminal.md)

## Inherited from T3 Code

These pages describe T3 Code features still in the code that Probe has not reviewed yet. Some name
T3 Code products (releases, T3 Connect, the mobile app) that do not exist for Probe.

- [Install T3 Code](./user/install.md)
- [Source control](./user/source-control.md)
- [Appearance and themes](./user/appearance.md)
- [Keyboard shortcuts](./user/keybindings.md)
- [Product usage data](./user/telemetry.md)
- [Remote access](./user/remote-access.md)
- [T3 Connect troubleshooting](./user/t3-connect-troubleshooting.md)
- [Running in the background](./user/background-service.md)
- [Updating T3 Code](./user/updating.md)

## Chat (hidden in the terminal-first build)

These pages describe chat, which Probe hides. They are kept for history until the chat code is
removed.

- [Messages and context](./user/composer.md)
- [Working with threads](./user/thread-sidebar.md)
- [Permission modes](./user/permission-modes.md)
- [Project settings](./user/project-settings.md)
- [SnapShots](./user/snap-shot.md)
- [Visual replies](./user/html-renders.md)
- [Import browser sessions](./user/browser-import.md)
- [Use T3 Code as your default browser](./user/default-browser.md)
- [Devices](./user/devices.md)
- [Usage and limits](./user/usage.md)
- [Guest links](./user/guest-links.md)
- [Outside agents (MCP)](./user/outside-agents.md)
- [Triage an issue](./user/triage.md)
- Provider guides: [Codex](./user/providers-codex.md) · [Claude](./user/providers-claude.md) · [OpenCode](./user/providers-opencode.md) · [Antigravity](./user/providers-antigravity.md) · [Pi](./user/providers-pi.md) · [Muse Code](./user/providers-muse.md) · [fx](./user/providers-fx.md)

---

## Working on Probe

Start with the [development runbook](./operations/development.md) (including the
[scenario tests](./operations/development.md#scenario-tests)) and the
[contribution policy](../CONTRIBUTING.md). Project rules for agents are in [AGENTS.md](../AGENTS.md).

Internal notes preserve architectural decisions, constraints, and implementation traps that the
source alone does not explain. Most code changes do not need an internal documentation update. Follow the
[documentation rules](../AGENTS.md#documentation) before adding one.

- [Architecture overview](./internals/overview.md)
- [Glossary](./internals/glossary.md)
- [Connection runtime](./internals/connection-runtime.md)
- [Providers](./internals/providers.md)
- [Adding a provider](./internals/adding-a-provider.md)
- [Pull request file revisions](./internals/pull-request-file-revisions.md)
- [Model classification](./internals/model-manifest.md)
- [Remote environments](./internals/remote.md)
- [Server updates](./internals/server-updates.md)
- [Resource telemetry](./internals/resource-telemetry.md)
- [Product analytics](./internals/product-analytics.md)
- [Environment auth](./internals/environment-auth.md)
- [T3 Connect](./internals/t3-connect.md)
- [Assistant citations](./internals/assistant-citations.md)
- [Mobile navigation](./internals/mobile-navigation.md)
- [Mobile development lifecycle](./internals/mobile-development.md)
- [Terminal runtime](./internals/terminal-runtime.md)
- [Devices](./internals/devices.md)
- [Voice input](./internals/voice-input.md)

### Runbooks

- [Development and local builds](./operations/development.md)
- [T3 Connect setup](./operations/connect-setup.md)
- [Release](./operations/release.md)
- [Observability](./operations/observability.md)
- [Relay observability](./operations/relay-observability.md)
- [Mobile app store screenshots](./operations/mobile-app-store-screenshots.md)

### Planning

Work that is planned or in flight lives in `dev/`; the rest of these docs describe what exists.
What goes where is in the [documentation rules](../AGENTS.md#documentation), and tickets are
managed with `tm` as the [tickets skill](../.agents/skills/tickets/SKILL.md) describes.

- [Roadmap](./dev/roadmap.md): settled product and scope decisions, and phase order
- [Open questions](./dev/questions.md): unverified assumptions and pending decisions that span tickets
- Tickets: [epics](./dev/epics/) and [tasks](./dev/tasks/), in `backlog/`, `in-progress/` or `done/`
- [Design drafts](./dev/design/) and [research](./dev/research/): product studies and spike reports
