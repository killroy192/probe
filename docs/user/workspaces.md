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
nothing. Settings stays at the bottom of the sidebar. Search and **Add project**
are not active yet: they start working once workspaces hold folders and shells.

Removing a workspace deletes its saved entry. It never deletes folders on disk.
Removing the shown workspace returns to the start screen, where **Open
workspace** lists the rest.

A reload returns to the start screen; the list of saved workspaces stays.

## Names

A name is 1 to 64 characters and must be unique, ignoring letter case. It can't
contain `/ \ : * ? " < > |` or control characters, end with a dot, or be a name
the file system reserves, such as `con` or `nul`, because each workspace is
saved as a file named after it in the server's `userdata/workspaces` folder.

If a saved workspace file is unreadable or damaged, it stays in the list and
opening it shows why.
