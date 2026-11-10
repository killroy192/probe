# Workspaces

The browser app opens on a terminal-first screen. A workspace is a named
collection of projects and the shells you run in them; its shell tree has the
workspace as its root. Chat is hidden in this build: no control opens a chat,
and an old chat link or bookmark lands on the shown workspace, or on the start
screen when none is shown.

## Start

With no workspace shown, the screen offers two actions:

- **Create workspace** asks for a name and shows the new workspace.
- **Open workspace** lists the workspaces saved on the server, by name. Choose
  one to show it.

New workspaces have no projects or shells yet, so the tree shows only the
workspace's name.

## Switch, create and remove

The left sidebar shows the shown workspace as the root of its shell tree. The
**Workspaces** button at the top of the sidebar creates a workspace, opens
another saved one, or removes one. Opening the workspace already shown changes
nothing. Settings stays at the bottom of the sidebar. Search is not active yet.

Removing a workspace deletes its saved entry and kills every running shell in
its projects, including shells another workspace started in a project they
share. It never deletes folders or worktrees on disk. Removing the shown
workspace returns to the start screen, where **Open workspace** lists the rest.

A reload shows the same workspace again, in the same browser, with its tabs.

## Projects and shells

A workspace holds projects, and each shell runs in one of them. Click **+** on a
project's row in the sidebar to open **Create shell**, then click the up-arrow
button. The shell opens in a new tab and appears in the tree under its project.
Git projects also ask where the shell runs (see [Worktrees](#worktrees)).
Shells are named by their number in the workspace, their project and the
program running in them, such as "Shell 2 · repo · node".
Pick what the shell runs under **Starting script** (see
[Starting scripts](#starting-scripts)). Leaving the agent leaves the shell open.

To add a project, click the **Add project** icon at the top of the sidebar.
Adding a project starts no shell:

- **Import existing folder** adds a folder that is already on the server's
  disk. Git repositories show a `git` badge. If the folder is a worktree of
  another repository, that repository is added instead.
- **Create new folder** makes a folder in the place you choose and runs
  `git init` in it. If `git init` fails, the new folder is removed again.

Both start at the server's home folder (`~/`). Click the path field to list the
folders there: click a folder to go into it, or `..` to go up. You can also type
a path. When the server runs on another machine, the field's label says
(remote server), because the folder is created or read there. In the desktop app
with its own server, **Choose in Finder…** opens the system folder dialog
instead.

## Worktrees

For a git project, **Create shell** has two choices:

- **Existing** starts the shell in one of the project's worktrees. The first one
  is the project's own folder, its **primary** worktree, shown by the branch it
  has checked out. The others show their branch (or short commit id) and their
  folder name. A worktree can hold any number of shells.
- **Fork** gives the shell a new worktree of its own. Pick what it forks from: a
  worktree (its current commit) or a local branch; the primary worktree's
  current branch is chosen at first. Probe names the new worktree and its branch
  `probe-worktree-` plus six hex digits, and creates it in the
  `worktrees/<repository>` folder of the server's home. A repository needs at
  least one commit before it can be forked.

If creating the worktree fails, the dialog says why and nothing is left
behind. If the worktree is made but its shell cannot start, the worktree is
kept and listed under **Existing**. Probe never deletes a worktree when a shell
ends.

The dialog remembers the last successful start in the workspace, so the next
one in the same project is a single click. A remembered worktree or branch that
is gone falls back to the primary worktree and its current branch.

In the tree, a project lists the worktrees that have running shells, each
labelled by its branch: "primary · main" for the project's own folder, or the
worktree's folder name and branch. Switching branch in any of its shells updates
the label within a few seconds. A shell that changes directory out of its
worktree stays there, marked "elsewhere"; hover the mark to see where it is.
Shells in projects that are not git repositories sit directly under the
project.

A project whose folder was deleted or moved on disk is marked "moved" and can't
start shells. It stays while it still has shells, so they can be seen and
removed, and leaves the workspace once its last shell is gone. A worktree folder
that is gone is marked the same way.

To take a project out of the workspace, hover its row and click the remove
icon, then confirm. Every running shell in the project is killed, including
shells another workspace started there; the folder and its worktrees stay on
disk. A moved project can be removed the same way.

## Tabs, close and kill

Each shell you start or select in the tree opens as a tab. Closing a tab (the
**×** its icon turns into on hover) only hides the terminal: the shell keeps
running, stays in the tree, and selecting it there opens its tab again with the
output it printed meanwhile. The open tabs and the selected one are saved with
the workspace.

To end a shell, hover its row in the tree, click **×** and confirm. The kill
ends the shell and everything it started, such as background jobs and the
programs an agent ran. A worktree the shell was forked into stays on disk.

Inside a shell, the command `probe kill` does the same to that shell, so an
agent can end its own shell. If the shell's startup files replace `PATH`, run
`"$PROBE_BIN" kill` instead. When the server can't be reached, the command says
so and the shell keeps running.

## Reloads and restarts

Shells run on the server, not in the page, so a reload or a closed browser
leaves them running. Stopping the server or closing the app leaves them running
too: when the server starts again, each shell is back as the same process, with
its output, in the same place in the tree, and the workspace opens with the same
tabs. A small helper process owns the shells while the server is down; it ends
by itself once no shells are left.

A shell that ends on its own, whatever its exit status, leaves the tree for
good, as a killed shell does. A shell that a signal ended, or that was lost
because its helper ended (for example in a reboot), stays in the tree marked
"ended"; hover the mark to see why. An ended shell has no running process and
nothing restores it by itself: hover its row and click **Restore** to start it
again in the same folder, worktree and branch, or **×** to remove it. A restored
shell is a new shell with empty output, marked "restored", and no agent is
started in it; if its tab was open when it ended, the tab comes back.

When a shell's folder or worktree is gone from disk, its row is marked "moved".
A shell still running there keeps working; an ended one can only be removed, not restored.

## Starting scripts

**Plain shell** opens a shell at its prompt and types nothing. Any other entry
is one of your starting scripts: the shell opens, and once its prompt shows the
script's command is typed into it. Each project remembers the script of its
last start, and **Create shell** preselects it; if that script is gone, it
preselects Plain shell.

Your scripts can't be edited in Probe yet, so a new server offers Plain shell
only. The program a script runs must be one your shell on that server can run: a
program on its `PATH` after your startup files ran, a path from the chosen
folder, an alias, a function or a builtin. When it is not, no shell is left
and the dialog says which program was not found. A command that exits, or
fails after it started, leaves the shell open at its prompt.

## Names

A name is 1 to 64 characters and must be unique, ignoring letter case. It can't
contain `/ \ : * ? " < > |` or control characters, end with a dot, or be a name
the file system reserves, such as `con` or `nul`, because each workspace is
saved as a file named after it in the server's `userdata/workspaces` folder.

If a saved workspace file is unreadable or damaged, it stays in the list and
opening it shows why.
