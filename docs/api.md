# API

[中文](api.zh-CN.md) | [Back to README](../README.md)

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

Hub-to-Node requests use:

```http
Authorization: Bearer <TMUXFLEET_NODE_TOKEN>
```

## Connected Agent

Connected Node agent endpoints use the same bearer token:

- `POST /api/agent/register`
- `POST /api/agent/poll`
- `POST /api/agent/result`

## Auto-Recover

Auto-recover is opt-in per session. The Hub scans enabled sessions every 20
seconds, watches recent tmux output for API/network connection error patterns,
and sends `go on` to the configured window.

The same error fingerprint is not sent twice, and different errors are cooled
down for 120 seconds between sends.

Smart recover is an optional LLM fallback for sessions where local rules do not
match. It is disabled by default and only runs for sessions where smart recover
is enabled in the UI.

Configure any OpenAI-compatible chat completions endpoint, for example DeepSeek:

```bash
export TMUXFLEET_RECOVERY_LLM_URL=https://api.deepseek.com/chat/completions
export TMUXFLEET_RECOVERY_LLM_KEY=...
export TMUXFLEET_RECOVERY_LLM_MODEL=deepseek-chat
```

The Hub sends only recent terminal output, asks for strict JSON, and sends
`go on` only when the model returns `should_send_go_on: true` with confidence at
least `0.8`.
