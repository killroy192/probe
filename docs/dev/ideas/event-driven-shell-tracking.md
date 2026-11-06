# Event-driven shell and project tracking

Today the server learns about a shell's surroundings by polling every 2 seconds while shells exist
(`Shells.refreshLocations`): it reads each worktree's `HEAD` file for the branch, each shell
process's current folder (`/proc/<pid>/cwd` on Linux, one `lsof` on macOS) for "elsewhere", and
whether each shell's folder still exists for "not found". The web reads a project's own existence
only when it opens a workspace, again when a shell is newly not found, and when the window regains
focus. Changes show up to 2 seconds late, the poll costs work when nothing changes, and a project
deleted while nobody looks only shows as missing on the next trigger.

## Proposed shape

Use the cheapest event source each platform offers, and keep the 2 s poll as the fallback where no
event source works.

- **Folder:** shell integration. Have each shell report its folder with OSC 7 on every prompt
  (`printf '\e]7;file://%s%s\a'`), set up through the env Probe already injects. The server reads it
  from the PTY stream it already parses, so "elsewhere" is exact and free. Poll only for shells that
  never sent one.
- **Branch:** watch each worktree's `HEAD` file (and the linked worktree's gitdir) with `fs.watch`
  (inotify, FSEvents). Re-read on any event; git replaces `HEAD` by rename, so watch the folder.
- **Existence of folders, worktrees and projects:** watch each one's parent folder for renames and
  deletes, and push the change to clients as part of the workspace (a workspace stream rather than
  the one-shot `workspace.open`), so the tree marks a project missing at once.
- **Fallback:** keep the 2 s poll per item whose watch could not be set up or is known to be
  unreliable: network and container-mounted folders (unverified whether a Mac folder mounted into
  a Linux container delivers inotify events for changes made on the Mac side), too many watches.

## Open questions

- How to detect that a mount does not deliver events, so the fallback is chosen per folder rather
  than per platform.
- Whether OSC 7 survives every shell users run (zsh, bash, fish) and agents that start subshells.
- Watch limits (`fs.inotify.max_user_watches`) with many worktrees.
