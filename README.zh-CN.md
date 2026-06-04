# tmuxfleet

[English README](README.md)

tmuxfleet 是一个小型 Hub + Node 控制台，用来跨机器管理 tmux sessions。

它刻意比 StarAgent 更小。tmux 始终是事实来源：tmuxfleet 只负责列出
session、创建 session、抓取输出、发送输入，以及在浏览器、Hub、Node 之间代理请求。

## 它能做什么

- 列出本机和远程 Node 上的 tmux sessions。
- 用指定工作目录和命令创建新的 tmux session。
- 在浏览器里打开某个 session。
- 支持一个 tmux session 里的多个 window。
- 向选中的 tmux window 发送单行输入。
- 显示从终端输出整理出来的 Chat 视图。
- 保留原始 Terminal 视图用于排查问题。
- 停止 tmux sessions。

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

## 依赖

- Node.js 18+
- tmux

不需要安装 npm 依赖。

## 启动 Hub

在你想打开 Dashboard 的机器上：

```bash
cd /agent-dev/tmuxfleet

export TMUXFLEET_HUB_TOKEN="$(node -e 'console.log(require("crypto").randomBytes(24).toString("base64url"))')"
export TMUXFLEET_NODE_TOKEN="$TMUXFLEET_HUB_TOKEN"

node src/cli.js hub --host 127.0.0.1 --port 8090
```

打开：

```text
http://127.0.0.1:8090
```

用 `TMUXFLEET_HUB_TOKEN` 登录。

如果 Hub 需要被其他机器访问，或者需要从容器外的宿主机浏览器访问，绑定所有网卡：

```bash
node src/cli.js hub --host 0.0.0.0 --port 8090
```

Hub 绑定到非 loopback 地址时必须设置 `TMUXFLEET_HUB_TOKEN`。

## 启动主动连接的 Node

这是远程机器位于 NAT 或防火墙后面时的推荐模式。Hub 只监听一个公网端口，
每个 Node 都主动向 Hub 发起 outbound 连接。Node 不需要公网 IP，也不需要
给每台机器分配不同的转发端口。

在公网 Hub 上：

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

这个 Node 会自动出现在 Hub 的 Nodes 页面。每台机器使用不同的 `--name`。
所有 Node 都可以连接同一个 Hub URL 和端口。

## 启动 URL Node

当 Hub 可以直接访问每个 Node URL 时，仍然支持这个旧模式。

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

## Docker 说明

如果 Hub 或 Node 跑在 Docker 里，并且需要从宿主机浏览器访问，创建容器时需要发布端口：

```bash
-p 8090:8090
-p 8091:8091
```

这个 workspace 里有一个辅助脚本：

```bash
/agent-dev/docker/launch_docker_ports.sh
```

## 开发

UI 代码在 `src/views.js`。Hub 会在每次页面请求时动态加载这个文件，所以只改 UI
文案或样式时通常刷新浏览器即可。

后端/API 改动仍然需要重启进程。可以用 Node 的 watcher：

```bash
TMUXFLEET_HUB_TOKEN=test-token TMUXFLEET_NODE_TOKEN=test-token \
npm run dev:hub -- --host 127.0.0.1 --port 8090
```

语法检查：

```bash
npm run check
```

## API 形状

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
- `GET /api/nodes`
- `POST /api/nodes`
- `DELETE /api/nodes/:name`

Hub 请求 Node 时使用：

```http
Authorization: Bearer <TMUXFLEET_NODE_TOKEN>
```

主动连接的 Node agent endpoints 使用同一个 bearer token：

- `POST /api/agent/register`
- `POST /api/agent/poll`
- `POST /api/agent/result`

## 当前限制

- 终端输出使用 HTTP 轮询，不是 WebSocket。
- 主动连接的 Node 使用 Hub 命令轮询，不是持久 WebSocket。
- 输入是按行发送，不是完整键盘/PTY 交互。
- 已支持一个 tmux session 里的多个 window；暂不支持选择同一个 window 里的多个 pane。
- Chat 目前是从终端输出启发式整理出来的，还不是真正的 Codex/Claude transcript parser。
- URL Node 应只在可信网络中访问。主动连接的 Node 只需要能 outbound 访问 Hub。

## 致谢

tmuxfleet 受 [SiriusNEO/StarAgent](https://github.com/SiriusNEO/StarAgent)
启发，并在其相关工作中发展而来。

## 文档维护

`README.md` 是英文主文档。每次修改它时，需要在同一个变更里同步更新
`README.zh-CN.md`。
