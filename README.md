# tmuxfleet

[中文文档](README.zh-CN.md)

tmuxfleet is a small Hub + Node dashboard for managing tmux sessions across
machines.

It is intentionally smaller than StarAgent. tmux stays the source of truth:
tmuxfleet only lists sessions, creates sessions, captures output, sends input,
and proxies requests between the browser, the Hub, and Nodes.

## What It Does

- Lists tmux sessions from the local machine and remote Nodes.
- Creates new tmux sessions with a selected working directory and command.
- Opens a session in the browser.
- Supports multiple tmux windows inside one session.
- Sends one-line input to the selected tmux window.
- Can auto-recover selected agent sessions by sending `go on` after API or
  network connection errors appear in tmux output.

- Keeps a raw Terminal view for debugging.
- Stops tmux sessions.

## Architecture

```text
Browser
  |
  | HTTP
  v
Hub
  |
  | local tmux calls
  | HTTP proxy to remote Nodes
  | command queue for connected Nodes
  v
Node
  |
  v
tmux sessions
```

- Run one Hub where you want to open the dashboard.
- Run one Node on every machine that owns tmux sessions.
- The browser talks only to the Hub.
- The Hub either controls local tmux directly, proxies requests to a Node URL,
  or queues commands for Nodes that connect back to the Hub.

## Requirements

- Node.js 18+
- tmux

No npm dependencies are required.

## Run The Hub

On the machine where you want to open the dashboard:

```bash
cd /agent-dev/tmuxfleet

export TMUXFLEET_HUB_TOKEN="$(node -e 'console.log(require("crypto").randomBytes(24).toString("base64url"))')"
export TMUXFLEET_NODE_TOKEN="$TMUXFLEET_HUB_TOKEN"

node src/cli.js hub --host 127.0.0.1 --port 8090
```

Open:

```text
http://127.0.0.1:8090
```

Log in with `TMUXFLEET_HUB_TOKEN`.

If the Hub needs to be reached from another machine or from the host outside a
container, bind it to all interfaces:

```bash
node src/cli.js hub --host 0.0.0.0 --port 8090
```

`TMUXFLEET_HUB_TOKEN` is required when binding the Hub to a non-loopback address.

## Run A Connected Node

This is the recommended mode for remote machines behind NAT or firewalls. The
Hub listens on one public port, and every Node makes an outbound connection to
the Hub. Nodes do not need public IP addresses or unique forwarded ports.

On the public Hub:

```bash
cd /agent-dev/tmuxfleet

export TMUXFLEET_HUB_TOKEN="<browser login token>"
export TMUXFLEET_NODE_TOKEN="<shared node token>"

node src/cli.js hub --host 0.0.0.0 --port 8090
```

On every machine that owns tmux sessions:

```bash
cd /agent-dev/tmuxfleet

export TMUXFLEET_NODE_TOKEN="<shared node token>"
node src/cli.js node --connect http://<hub-host-or-ip>:8090 --name devbox
```

If a Node must reach an HTTP Hub through a network proxy, set the standard
`http_proxy` or `HTTP_PROXY` environment variable before starting the Node:

```bash
export http_proxy=http://127.0.0.1:7890
node src/cli.js node --connect http://<hub-host-or-ip>:8090 --name devbox
```

The Node appears automatically on the Hub's Nodes page. Use a different `--name`
for each machine. All Nodes can connect to the same Hub URL and port.

## Run A URL Node

This older mode is still supported when the Hub can directly reach each Node URL.

On every machine that should expose tmux sessions:

```bash
cd /agent-dev/tmuxfleet

export TMUXFLEET_NODE_TOKEN="<same token used by the Hub>"
node src/cli.js node --host 0.0.0.0 --port 8091
```

Then add the Node URL on the Hub's Nodes page:

```text
http://<node-host-or-ip>:8091
```

For remote machines, prefer LAN, Tailscale, WireGuard, or an SSH tunnel. Do not
expose a Node directly to the public internet.

## Docker Notes

If the Hub or Node runs inside Docker and must be opened from the host browser,
publish the ports when creating the container:

```bash
-p 8090:8090
-p 8091:8091
```

For this workspace, there is a helper script:

```bash
/agent-dev/docker/launch_docker_ports.sh
```

## Development

UI code lives in `src/views.js`. The Hub dynamically reloads this file on every
page request, so UI text/style changes usually only need a browser refresh.

Backend/API changes still need a process restart. You can use Node's watcher:

```bash
TMUXFLEET_HUB_TOKEN=test-token TMUXFLEET_NODE_TOKEN=test-token \
npm run dev:hub -- --host 127.0.0.1 --port 8090
```

Check syntax and run tests:

```bash
npm run check
```

## API Shape

Node:

- `GET /api/health`
- `GET /api/sessions`
- `POST /api/sessions`
- `DELETE /api/sessions/:name`
- `GET /api/sessions/:name/windows`
- `GET /api/sessions/:name/output?window=0&lines=500`
- `POST /api/sessions/:name/send`

Hub:

- `GET /sessions`
- `GET /nodes`
- `GET /sessions/:node/:name?window=0`
- `GET /api/sessions`
- `POST /api/sessions`
- `DELETE /api/sessions/:node/:name`
- `GET /api/sessions/:node/:name/windows`
- `GET /api/sessions/:node/:name/output?window=0&lines=500`
- `POST /api/sessions/:node/:name/send`
- `PUT /api/sessions/:node/:name/autorecover`
- `GET /api/nodes`
- `POST /api/nodes`
- `DELETE /api/nodes/:name`

Auto-recover is opt-in per session. The Hub scans enabled sessions every 20
seconds, watches recent tmux output for API/network connection error patterns,
and sends `go on` to the configured window. The same error fingerprint is not
sent twice, and different errors are cooled down for 120 seconds between sends.

Smart recover is an optional LLM fallback for sessions where local rules do not
match. It is disabled by default and only runs for sessions where smart recover
is enabled in the UI. Configure any OpenAI-compatible chat completions endpoint,
for example DeepSeek:

```bash
export TMUXFLEET_RECOVERY_LLM_URL=https://api.deepseek.com/chat/completions
export TMUXFLEET_RECOVERY_LLM_KEY=...
export TMUXFLEET_RECOVERY_LLM_MODEL=deepseek-chat
```

The Hub sends only recent terminal output, asks for strict JSON, and sends
`go on` only when the model returns `should_send_go_on: true` with confidence at
least `0.8`.

Hub-to-Node requests use:

```http
Authorization: Bearer <TMUXFLEET_NODE_TOKEN>
```

Connected Node agent endpoints use the same bearer token:

- `POST /api/agent/register`
- `POST /api/agent/poll`
- `POST /api/agent/result`

## Current Limits

- Terminal output uses HTTP polling, not WebSocket.
- Connected Nodes use Hub command polling, not a persistent WebSocket.
- Input is line-based, not full keyboard/PTY interaction.
- Multiple tmux windows are supported; multiple panes inside one window are not
  yet selectable.

- URL Nodes should be reachable only on trusted networks. Connected Nodes only
  need outbound access to the Hub.

## Acknowledgements

tmuxfleet is inspired by and developed alongside
[SiriusNEO/StarAgent](https://github.com/SiriusNEO/StarAgent).

## Documentation Maintenance

`README.md` is the source English document. When it changes, update
`README.zh-CN.md` in the same change.
