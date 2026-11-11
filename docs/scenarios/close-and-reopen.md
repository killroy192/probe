# Close a tab and reopen it

A developer closes a shell's tab to tidy the tab strip without ending the shell. The shell keeps
running in the tree, and selecting it there opens its tab again with everything it printed meanwhile.

## Workflows

### Close a tab

1. Hover a tab and click the **×** its icon turns into.
2. The tab and its terminal go away. The shell keeps running and stays in the tree.

- Closing every tab leaves the notice "No open shells", no terminal and no error; the shells stay in
  the tree.
- A tab closed before a reload stays closed after it.

### Reopen a tab from the tree

1. Click the shell's row in the tree.
2. Its tab opens again, selected, on the same running shell.
3. The tab shows what the shell printed while its tab was closed, and takes typed input.

- After a reload, a reopened tab shows the shell's earlier output once.

## Requirements

| ID   | Requirement                                                                                               |
| ---- | --------------------------------------------------------------------------------------------------------- |
| FR-1 | Closing a tab removes the tab and its terminal from the page.                                             |
| FR-2 | A shell whose tab was closed keeps running.                                                               |
| FR-3 | A shell whose tab was closed stays in the tree.                                                           |
| FR-4 | Clicking a shell's row in the tree opens its tab again, selected, on the same running shell.              |
| FR-5 | Output a shell printed while its tab was closed shows when the tab reopens.                               |
| FR-6 | Closing every tab leaves the notice "No open shells" and shows no error.                                  |
| FR-7 | A tab closed before a reload stays closed after it.                                                       |
| FR-8 | After a reload, a tab reopened from the tree shows its shell's earlier output once and takes typed input. |

## Related

- [Tabs, close and kill](../user/workspaces.md#tabs-close-and-kill)
- [Reloads and restarts](../user/workspaces.md#reloads-and-restarts)
- [Shell host](../internals/terminal-runtime.md#shell-host)
