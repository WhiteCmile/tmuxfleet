# tmuxfleet

[English README](README.md)

tmuxfleet 是一个小型 Hub + Node 控制台，用来跨机器管理 tmux sessions。

tmux 始终是事实来源。tmuxfleet 负责列出 session、创建 session、把输出抓取成
适合浏览器阅读的 chat/log 视图、发送输入，以及在浏览器、Hub、Node 之间代理请求。

## 功能

- 列出本机和远程 Node 上的 tmux sessions。
- Dashboard 自动刷新：session 和节点的状态、数量、更新时间原地刷新，无需手动刷新页面。
- 每个 session 的活动指示：显示前台命令（例如正在运行的 agent），标记空闲 shell，超过 60 秒没有新输出时标红提示可能卡住。
- Web UI 跟随系统浅色/深色主题。
- 用指定工作目录和命令创建 session。
- 在浏览器友好的 chat/log 视图里打开 session，并发送按行输入。
- 在同一个 tmux session 的多个 window 之间切换。
- 可选地为指定 agent session 开启 API 或网络错误后的自动恢复。
- 从 Dashboard 停止 tmux sessions。

## 依赖

- Node.js 18+
- tmux

tmuxfleet 刻意不使用 npm runtime dependencies。

## 快速开始

启动本机 Hub：

```bash
export TMUXFLEET_HUB_TOKEN="$(node -e 'console.log(require("crypto").randomBytes(24).toString("base64url"))')"
export TMUXFLEET_NODE_TOKEN="$TMUXFLEET_HUB_TOKEN"

node src/cli.js hub --host 127.0.0.1 --port 8090
```

打开：

```text
http://127.0.0.1:8090
```

使用 `TMUXFLEET_HUB_TOKEN` 登录。

远程机器场景下，在一台可访问的机器上运行 Hub，在拥有 tmux sessions 的机器上
运行主动连接的 Node：

```bash
export TMUXFLEET_NODE_TOKEN="<shared node token>"
node src/cli.js node --connect http://<hub-host-or-ip>:8090 --name devbox
```

主动连接 Node、URL Node、代理、Docker 和安全说明见
[部署](docs/deployment.zh-CN.md)。

## 文档

- [部署](docs/deployment.zh-CN.md)：Hub、主动连接 Node、URL Node、Docker 和网络建议。
- [API](docs/api.zh-CN.md)：Hub、Node 和 connected-agent endpoints。
- [开发](docs/development.zh-CN.md)：本地开发、验证和项目说明。

## 当前限制

- 终端输出使用 HTTP 轮询，不是 WebSocket。
- 主动连接的 Node 使用 Hub 命令轮询，不是持久 WebSocket。
- 输入是按行发送，不是完整键盘/PTY 交互。
- 已支持一个 tmux session 里的多个 window；暂不支持选择同一个 window 里的多个 pane。

## 致谢

tmuxfleet 受 [SiriusNEO/StarAgent](https://github.com/SiriusNEO/StarAgent)
启发，并在其相关工作中发展而来。
