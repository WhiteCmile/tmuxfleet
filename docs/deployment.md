# Deployment

[中文](deployment.zh-CN.md) | [Back to README](../README.md)

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

## Hub

On the machine where you want to open the dashboard:

```bash
cd /agent-dev/tmuxfleet

export TMUXFLEET_HUB_TOKEN="$(node -e 'console.log(require("crypto").randomBytes(24).toString("base64url"))')"
export TMUXFLEET_NODE_TOKEN="$TMUXFLEET_HUB_TOKEN"

node src/cli.js hub --host 127.0.0.1 --port 8090
```

Open `http://127.0.0.1:8090` and log in with `TMUXFLEET_HUB_TOKEN`.

If the Hub must be reached from another machine or from the host outside a
container, bind it to all interfaces:

```bash
node src/cli.js hub --host 0.0.0.0 --port 8090
```

`TMUXFLEET_HUB_TOKEN` is required when binding the Hub to a non-loopback address.

## Connected Nodes

Connected Node mode is recommended for remote machines behind NAT or firewalls.
The Hub listens on one reachable port, and every Node makes an outbound
connection to the Hub.

On the Hub:

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

Use a different `--name` for each machine. The Node appears automatically on
the Hub's Nodes page.

If a Node must reach an HTTP Hub through a proxy, set `http_proxy` or
`HTTP_PROXY` before starting it:

```bash
export http_proxy=http://127.0.0.1:7890
node src/cli.js node --connect http://<hub-host-or-ip>:8090 --name devbox
```

## URL Nodes

URL Node mode is supported when the Hub can directly reach each Node URL.

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

## Docker

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

## Security

- Use a strong `TMUXFLEET_HUB_TOKEN` for browser login.
- Use a shared `TMUXFLEET_NODE_TOKEN` for Hub-to-Node and connected-agent
  authentication.
- URL Nodes should be reachable only on trusted networks.
- Connected Nodes only need outbound access to the Hub.
