# Run a second server beside the first

A developer runs a second Probe server on the same machine, with its own state folder, and connects the browser to it alongside the server that serves the UI. Each server keeps its own workspaces and shells, and the browser keeps each server's credential to that server.

## Workflows

### Start a second server

1. Start a second server with its own state folder and port, outside the first server's state folder.
2. Each server runs as its own process on its own origin and records its own process in its own state folder.
3. Create workspaces and projects on each. A workspace name may exist on both servers; each holds its own projects.
4. A shell opened on the second server is listed there, at its prompt, and not on the first.

### Connect the browser to the second server

1. Pair the browser, served by the first server, with the second server, so the second server is saved in its connections.
2. The browser connects to the second server and holds a credential that lists its workspaces.
3. **Settings → Environments** lists the second server by its label.

- The browser never sends the second server's credential to the first server.

## Requirements

| ID   | Requirement                                                                                                                                         |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-1 | Two servers on one machine run as separate processes on separate origins.                                                                           |
| FR-2 | Each server records its own process in its own state folder, and neither state folder lies inside the other.                                        |
| FR-3 | A workspace created on one server is not listed by the other.                                                                                       |
| FR-4 | A workspace name may exist on both servers, each with its own projects in its own server's folders.                                                 |
| FR-5 | A shell opened on one server is listed by that server and not by the other.                                                                         |
| FR-6 | A browser served by one server connects to a second server saved in its connections, and its saved credential lists the second server's workspaces. |
| FR-7 | Settings → Environments lists a saved second server by its label.                                                                                   |
| FR-8 | The browser never sends a saved server's credential to another server.                                                                              |

## Related

- [Remote access: Pair over a LAN or private network](../user/remote-access.md#pair-over-a-lan-or-private-network)
- [Development: State and ports](../operations/development.md#state-and-ports)
