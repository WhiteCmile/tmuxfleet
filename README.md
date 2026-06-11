# tmuxfleet

[中文文档](README.zh-CN.md)

tmuxfleet is a small Hub + Node dashboard for managing tmux sessions across
machines.

tmux stays the source of truth. tmuxfleet lists sessions, creates sessions,
captures output, sends input, resizes tmux windows to match the browser, and
proxies requests between the browser, the Hub, and Nodes.

## Features

- List local and remote tmux sessions.
- Live dashboard: session and node status, counts, and timestamps refresh in
  place without page reloads.
- Web UI follows the system light/dark color scheme.
- Create sessions with a working directory and command.
- Open a session in the browser and send line-based input.
- Switch between multiple tmux windows in one session.
- Resize tmux windows to match the browser terminal area.
- Optionally auto-recover selected agent sessions after API or network errors.
- Stop tmux sessions from the dashboard.

## Requirements

- Node.js 18+
- tmux

tmuxfleet intentionally has no npm runtime dependencies.

## Quick Start

Start a local Hub:

```bash
export TMUXFLEET_HUB_TOKEN="$(node -e 'console.log(require("crypto").randomBytes(24).toString("base64url"))')"
export TMUXFLEET_NODE_TOKEN="$TMUXFLEET_HUB_TOKEN"

node src/cli.js hub --host 127.0.0.1 --port 8090
```

Open:

```text
http://127.0.0.1:8090
```

Log in with `TMUXFLEET_HUB_TOKEN`.

For remote machines, run the Hub on one reachable machine and run connected
Nodes on machines that own tmux sessions:

```bash
export TMUXFLEET_NODE_TOKEN="<shared node token>"
node src/cli.js node --connect http://<hub-host-or-ip>:8090 --name devbox
```

See [Deployment](docs/deployment.md) for connected Nodes, URL Nodes, proxies,
Docker, and security notes.

## Documentation

- [Deployment](docs/deployment.md): Hub, connected Nodes, URL Nodes, Docker, and
  network guidance.
- [API](docs/api.md): Hub, Node, and connected-agent endpoints.
- [Development](docs/development.md): local development, verification, and
  project notes.

## Current Limits

- Terminal output uses HTTP polling, not WebSocket.
- Connected Nodes use Hub command polling, not a persistent WebSocket.
- Input is line-based, not full keyboard/PTY interaction.
- Multiple tmux windows are supported; multiple panes inside one window are not
  yet selectable.

## Acknowledgements

tmuxfleet is inspired by and developed alongside
[SiriusNEO/StarAgent](https://github.com/SiriusNEO/StarAgent).
