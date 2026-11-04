# Design: review comments, batches, and reference injection

## Goals

1. Leave comments on **any** file in the workspace, changed or not.
2. Collect many comments and send them as **one** unit.
3. Do not paste bulk content into the terminal. Stage a short reference; the agent fetches the content
   over MCP.
4. Staged text is **not submitted**, so the user can edit it first.
5. Expand the review view into its own window.

## Concepts

- **Comment**: `{ id, path, range, snippet, note, status }`. Anchored by path, line range and a text
  snippet so it can be re-located after edits. `status`: open, resolved.
- **Batch**: an immutable snapshot of selected comments (with code quoted at snapshot time).
  Addressable by id, can be sent to several sessions, can be re-sent.
- **Session**: a terminal tab with a registered target. In the fork, the server owns the PTY, so a
  session is a server terminal id.

## Flow

1. User selects text in a file (or browser pane), picks *Comment*.
2. Comments accumulate in a panel. User selects some, clicks **Inject**, and chooses a session
   (or **Copy**).
3. Server stores the batch, then writes one line to that session's PTY without Enter, e.g.
   `Address review batch #7 (5 comments, 3 files). Fetch it with probe MCP get_review_batch(7).`
4. The user edits the line if wanted and presses Enter.
5. The agent calls `get_review_batch(7)` and later `resolve_comment(id, note)`; the UI updates.

*Copy* puts the same line (or the full expanded text) on the clipboard for other terminals.

## MCP tools (draft)

| Tool | Purpose |
| --- | --- |
| `open_file(path, line?)` | Open a file in the review pane |
| `list_comments(status?)` | Pull open comments (never pushed by default) |
| `get_review_batch(id)` | Snapshot with paths, ranges, quoted code, notes |
| `resolve_comment(id, note?)` | Mark done |
| `reply_comment(id, text)` | Reply in thread |
| `get_selection()` | Current selection in the editor |

Agents receive the tools through the server's existing MCP HTTP server (`apps/server/src/mcp`).
*How an agent started in a terminal tab gets MCP config injected: unverified; see open questions.*

## Fallbacks without the fork

If probe's review core ever needs to run standalone: a localhost daemon plus a `probe-mcp` stdio shim
(inherits `ITERM_SESSION_ID` / `TMUX_PANE`), with staging through iTerm2 AppleScript
(`write text ... newline NO`) or tmux (`send-keys -l`). Not planned; kept as the escape hatch.

## Open design points

- Whether batch references reuse T3's context-record format
  (`docs/internals/composer-context-references.md`) or a simpler probe-specific one.
- Storage: server database vs. a gitignored file per worktree.
- Which agent CLIs handle the staged line cleanly (bracketed paste, multi-line input).
