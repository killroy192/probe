# Restore an ended shell

A developer finds a shell marked ended, because a signal ended it or it was lost with the helper that
owns shells, for example after a reboot. Only when they ask does it run again, in place, as a fresh
shell in the same folder.

## Workflows

### Restore a shell

1. A shell ended by a signal, or lost and shown after the server restarts, stays in the tree marked
   ended. Nothing starts it again by itself.
2. Hover its row and click **Restore**.
3. The shell runs again as a new process in the same folder, under the same row and title, marked
   "restored", with empty output.
4. If its tab was open when it ended, the tab comes back. Type in it as in any shell.

- A shell that exits or is killed leaves the tree, so nothing offers to restore it.
- An ended shell whose folder is gone is marked "moved" and offers no **Restore**; **×** still
  removes it.
- A restored shell is removed with **×** like any other.
- A shell started after a lost one takes the next number; the lost one keeps its own.

## Requirements

| ID    | Requirement                                                                                                           |
| ----- | --------------------------------------------------------------------------------------------------------------------- |
| FR-1  | An ended shell stays ended until the user clicks its row's Restore.                                                   |
| FR-2  | Hovering an ended shell's row offers Restore.                                                                         |
| FR-3  | Restore starts a new process for the same shell, in the same folder.                                                  |
| FR-4  | A restored shell's row is marked "restored".                                                                          |
| FR-5  | A restored shell starts with empty output.                                                                            |
| FR-6  | A restored shell takes typed input.                                                                                   |
| FR-7  | Restore brings back the shell's tab when the tab was open when the shell ended.                                       |
| FR-8  | A shell lost with the helper that owns shells can be restored after the server restarts.                              |
| FR-9  | A lost shell keeps its title number through its restore, and a shell started after the restart takes the next number. |
| FR-10 | A shell that exits or is killed leaves the tree, so no Restore is offered for it.                                     |
| FR-11 | An ended shell whose folder is gone is marked "moved" in the tree.                                                    |
| FR-12 | An ended shell whose folder is gone offers no Restore.                                                                |
| FR-13 | An ended shell whose folder is gone can be removed.                                                                   |
| FR-14 | A restored shell can be removed.                                                                                      |

## Related

- [Reloads and restarts](../user/workspaces.md#reloads-and-restarts)
- [Shell host](../internals/terminal-runtime.md#shell-host)
