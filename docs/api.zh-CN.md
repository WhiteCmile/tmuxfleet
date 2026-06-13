# API

[English](api.md) | [返回 README](../README.zh-CN.md)

## Node

- `GET /api/health`
- `GET /api/sessions`
- `POST /api/sessions`
- `DELETE /api/sessions/:name`
- `GET /api/sessions/:name/windows`
- `GET /api/sessions/:name/output?window=0&lines=500`
- `POST /api/sessions/:name/send`

## Hub

- `GET /sessions`
- `GET /nodes`
- `GET /sessions/:node/:name?window=0`
- `GET /api/sessions`
- `POST /api/sessions`
- `DELETE /api/sessions/:node/:name`
- `GET /api/sessions/:node/:name/windows`
- `GET /api/sessions/:node/:name/output?window=0&lines=500`
- `POST /api/sessions/:node/:name/send`
- `PUT /api/sessions/:node/:name/hide`
- `PUT /api/sessions/:node/:name/autorecover`
- `GET /api/nodes`
- `POST /api/nodes`
- `DELETE /api/nodes/:name`

Hub 请求 Node 时使用：

```http
Authorization: Bearer <TMUXFLEET_NODE_TOKEN>
```

## Connected Agent

主动连接的 Node agent endpoints 使用同一个 bearer token：

- `POST /api/agent/register`
- `POST /api/agent/poll`
- `POST /api/agent/result`

## 自动恢复

自动恢复按 session 手动开启。Hub 每 20 秒扫描已开启的 session，检查最近的
tmux 输出是否命中 API/网络连接错误模式，命中后向配置的 window 发送 `go on`。

同一条错误指纹不会重复发送；不同错误之间也会冷却 120 秒。

智能恢复是可选的 LLM 兜底层，用于本地规则没有命中的 session。它默认关闭，
并且只有在 UI 里给单个 session 开启后才会运行。

可以配置任意 OpenAI-compatible chat completions endpoint，例如 DeepSeek：

```bash
export TMUXFLEET_RECOVERY_LLM_URL=https://api.deepseek.com/chat/completions
export TMUXFLEET_RECOVERY_LLM_KEY=...
export TMUXFLEET_RECOVERY_LLM_MODEL=deepseek-chat
```

Hub 只发送最近一小段终端输出，要求模型返回严格 JSON，并且只有当模型返回
`should_send_go_on: true` 且 confidence 至少为 `0.8` 时才发送 `go on`。
