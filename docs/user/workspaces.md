# Workspaces

The browser app opens on a terminal-first screen. A workspace is a named
collection of folders and the shells you run in them; its shell tree has the
workspace as its root. Chat is hidden in this build: no control opens a chat,
and an old chat link or bookmark lands on the shown workspace, or on the start
screen when none is shown.

## Start

With no workspace shown, the screen offers two actions:

- **Create workspace** asks for a name and shows the new workspace.
- **Open workspace** lists the workspaces saved on the server, by name. Choose
  one to show it.

New workspaces have no folders or shells yet, so the tree shows only the
workspace's name.

## Switch, create and remove

The left sidebar shows the shown workspace as the root of its shell tree. The
**Workspaces** button at the top of the sidebar creates a workspace, opens
another saved one, or removes one. Opening the workspace already shown changes
nothing. Settings stays at the bottom of the sidebar. Search is not active yet.

Removing a workspace deletes its saved entry. It never deletes folders on disk.
Removing the shown workspace returns to the start screen, where **Open
workspace** lists the rest.

A reload returns to the start screen; the list of saved workspaces stays.

## Folders and shells

A workspace holds folders, and each shell runs in one of them. Click **+** at
the top of the sidebar to start a shell: pick a folder and click the up-arrow
button. The shell opens in a new tab and appears in the tree under its folder.
Shells are named by their number in the workspace, their folder and the
program running in them, such as "Shell 2 · repo · node".
It starts the server's agent command (see [Agent command](#agent-command)), and
leaving the agent leaves the shell open.

To add a folder, click the **Add project** icon in the sidebar. Adding a folder
starts no shell:

- **Import existing folder** adds a folder that is already on the server's
  disk. Folders that are git repositories show a `git` badge.
- **Create new folder** makes a folder in the place you choose and runs
  `git init` in it. If `git init` fails, the new folder is removed again.

Both start at the server's home folder (`~/`). Click the path field to list the
folders there: click a folder to go into it, or `..` to go up. You can also type
a path. When the server runs on another machine, the field's label says
(remote server), because the folder is created or read there. In the desktop app
with its own server, **Choose in Finder…** opens the system folder dialog
instead.

Each folder is also registered as a project on the server. The **+** dialog
lists only folders that still exist on disk, and preselects the folder you last
started a shell in. A folder deleted from disk stays in the tree, marked
"missing". Tabs last until the page is reloaded; the shells keep
running on the server until it stops.

## Agent command

The server types the command in its `PROBE_AGENT_COMMAND` environment variable
into each shell started from a workspace. Its first word must be a file or a
program on the server's `PATH`. When it is not set or not found, the shell does
not start and the dialog shows why.

## Names

A name is 1 to 64 characters and must be unique, ignoring letter case. It can't
contain `/ \ : * ? " < > |` or control characters, end with a dot, or be a name
the file system reserves, such as `con` or `nul`, because each workspace is
saved as a file named after it in the server's `userdata/workspaces` folder.

If a saved workspace file is unreadable or damaged, it stays in the list and
opening it shows why.
