# Run many shells side by side

A developer runs many shells at once, across projects and worktrees, and switches between them by
their tabs. Each shell keeps its own output, keeps running while another one is shown, and is shown
the same way again after a page reload.

## Workflows

### Run shells in several projects and worktrees

1. Start shells in two git projects, a plain folder project, an existing linked worktree and a new
   forked worktree of one project, and a second shell in the same linked worktree.
2. Each shell opens in its own tab and appears in the tree.
3. Click a shell's row in the tree, or its tab, and type a line: it runs in that shell only.

### Switch tabs

1. Click a tab. Its shell is shown and takes the keyboard.
2. The shell whose tab was shown before keeps running in the background.

### Reload the page

1. Reload the page.
2. The same shells are in the tree, the same tabs are open in the same order, and the same tab is
   selected.
3. Each open tab shows its shell's earlier output once. Output a shell printed while the page was
   reloading shows once too.

### Open a shell by its address

1. A client opens a shell in a folder on the server, with no workspace. It is listed with its id,
   folder and status.
2. Open the shell's direct address in the app. The page shows the shell, with what it printed
   before the page opened, sized to the pane.
3. Make the window smaller: the shell gets fewer rows and columns.
4. Reload the page: the same shell process is shown again with its earlier output.

## Requirements

| ID    | Requirement                                                                                                                              |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| FR-1  | Shells in different projects, in a project's own folder, in a linked worktree and in a forked worktree run at once, each in its own tab. |
| FR-2  | A line typed into the shown tab runs in that tab's shell and shows in no other shell's output.                                           |
| FR-3  | Clicking a tab shows its shell.                                                                                                          |
| FR-4  | Clicking a tab puts keyboard input in its shell.                                                                                         |
| FR-5  | A shell whose tab is no longer shown keeps running.                                                                                      |
| FR-6  | After a reload, the tree lists the same shells.                                                                                          |
| FR-7  | After a reload, the same tabs are open, in the same order.                                                                               |
| FR-8  | After a reload, the same tab is selected.                                                                                                |
| FR-9  | After a reload, each open tab shows its shell's earlier output once.                                                                     |
| FR-10 | Output a shell prints while the page reloads shows once after the reload.                                                                |
| FR-11 | A shell can be opened in a folder on the server without a workspace, and starts running there.                                           |
| FR-12 | The shell list shows each shell with its id, folder and status.                                                                          |
| FR-13 | A shell's direct address shows that shell, with the output it printed before the page opened.                                            |
| FR-14 | A shown shell takes the rows and columns of its pane, and fewer of both when the pane shrinks.                                           |
| FR-15 | Reloading a shell's page shows its earlier output again, and the same process keeps running.                                             |
| FR-16 | One click on start in Create shell starts one running shell and opens one tab for it.                                                    |
| FR-17 | A started shell's tab is named "Shell <n> · <folder> · <program>" and its tree node "Shell <n> · <program>".                             |
| FR-18 | A double click on start in Create shell starts one shell, with one tab and one tree node.                                                |
| FR-19 | Closing Create shell without a start adds no shell or tab.                                                                               |
| FR-20 | A start whose connection to the server drops is refused with a message that the connection was lost, and adds no shell.                  |
| FR-21 | After a dropped start, a retry from Create shell starts one shell once the page has reconnected.                                         |
| FR-22 | The server log records each shell's start with the shell's id and folder.                                                                |
| FR-23 | The server log records the end of a shell ended from outside Probe, with the shell's id.                                                 |
| FR-24 | A program a typed command starts is named in its shell's tab and tree node, and the name goes from both once Ctrl+C ends it.             |
| FR-25 | Showing a shell's tab has the server check again which program runs in it, and the server log records that.                              |

## Related

- [Projects and shells](../user/workspaces.md#projects-and-shells)
- [Tabs, close and kill](../user/workspaces.md#tabs-close-and-kill)
- [Reloads and restarts](../user/workspaces.md#reloads-and-restarts)
- [Terminal history](../user/terminal.md)
- [Shells and thread terminals](../internals/terminal-runtime.md#shells-and-thread-terminals)
- [Snapshots, not raw history](../internals/terminal-runtime.md#snapshots-not-raw-history)
