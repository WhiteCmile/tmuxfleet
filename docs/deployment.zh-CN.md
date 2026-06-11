# 部署

[English](deployment.md) | [返回 README](../README.zh-CN.md)

## 架构

```text
Browser
  |
  | HTTP
  v
Hub
  |
  | 本机 tmux 调用
  | HTTP 代理到远程 Node
  | 给主动连接的 Node 排队下发命令
  v
Node
  |
  v
tmux sessions
```

- 在你想打开 Dashboard 的机器上跑一个 Hub。
- 在每台拥有 tmux sessions 的机器上跑一个 Node。
- 浏览器只访问 Hub。
- Hub 要么直接控制本机 tmux，要么把请求代理到 Node URL，要么给主动连回
  Hub 的 Node 排队下发命令。

## Hub

在你想打开 Dashboard 的机器上：

```bash
cd /agent-dev/tmuxfleet

export TMUXFLEET_HUB_TOKEN="$(node -e 'console.log(require("crypto").randomBytes(24).toString("base64url"))')"
export TMUXFLEET_NODE_TOKEN="$TMUXFLEET_HUB_TOKEN"

node src/cli.js hub --host 127.0.0.1 --port 8090
```

打开 `http://127.0.0.1:8090`，用 `TMUXFLEET_HUB_TOKEN` 登录。

如果 Hub 需要被其他机器访问，或者需要从容器外的宿主机浏览器访问，绑定所有网卡：

```bash
node src/cli.js hub --host 0.0.0.0 --port 8090
```

Hub 绑定到非 loopback 地址时必须设置 `TMUXFLEET_HUB_TOKEN`。

## 主动连接的 Node

主动连接 Node 是远程机器位于 NAT 或防火墙后面时的推荐模式。Hub 只监听一个
可访问端口，每个 Node 都主动向 Hub 发起 outbound 连接。

在 Hub 上：

```bash
cd /agent-dev/tmuxfleet

export TMUXFLEET_HUB_TOKEN="<browser login token>"
export TMUXFLEET_NODE_TOKEN="<shared node token>"

node src/cli.js hub --host 0.0.0.0 --port 8090
```

在每台拥有 tmux sessions 的机器上：

```bash
cd /agent-dev/tmuxfleet

export TMUXFLEET_NODE_TOKEN="<shared node token>"
node src/cli.js node --connect http://<hub-host-or-ip>:8090 --name devbox
```

每台机器使用不同的 `--name`。Node 会自动出现在 Hub 的 Nodes 页面。

如果 Node 需要通过代理访问 HTTP Hub，在启动前设置 `http_proxy` 或
`HTTP_PROXY`：

```bash
export http_proxy=http://127.0.0.1:7890
node src/cli.js node --connect http://<hub-host-or-ip>:8090 --name devbox
```

## URL Node

当 Hub 可以直接访问每个 Node URL 时，可以使用 URL Node 模式。

在每台需要暴露 tmux sessions 的机器上：

```bash
cd /agent-dev/tmuxfleet

export TMUXFLEET_NODE_TOKEN="<same token used by the Hub>"
node src/cli.js node --host 0.0.0.0 --port 8091
```

然后在 Hub 的 Nodes 页面添加 Node 地址：

```text
http://<node-host-or-ip>:8091
```

远程机器建议走 LAN、Tailscale、WireGuard 或 SSH 隧道。不要把 Node 直接暴露到公网。

## Docker

如果 Hub 或 Node 跑在 Docker 里，并且需要从宿主机浏览器访问，创建容器时需要发布端口：

```bash
-p 8090:8090
-p 8091:8091
```

这个 workspace 里有一个辅助脚本：

```bash
/agent-dev/docker/launch_docker_ports.sh
```

## 安全

- 给浏览器登录使用强 `TMUXFLEET_HUB_TOKEN`。
- Hub-to-Node 和 connected-agent 认证使用共享 `TMUXFLEET_NODE_TOKEN`。
- URL Node 应只在可信网络中访问。
- 主动连接的 Node 只需要能 outbound 访问 Hub。
