export function page(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · tmuxfleet</title>
  <style>${styles()}</style>
</head>
<body>
  <header>
    <a class="brand" href="/sessions">tmuxfleet</a>
    <nav>
      <a href="/sessions">会话</a>
      <a href="/nodes">节点</a>
    </nav>
    <form method="post" action="/logout"><button class="ghost" type="submit">退出</button></form>
  </header>
  <main class="${title.includes("/") ? "session-main" : ""}">${body}</main>
</body>
</html>`;
}

export function renderSessionsPage(nodeViews) {
  const rows = nodeViews.flatMap((node) => node.sessions.map((session) => ({ node, session })));
  return page("会话", `
    <section class="hero">
      <div>
        <h1>会话</h1>
        <p>已配置 ${nodeViews.length} 个节点，共 ${rows.length} 个 tmux 会话。</p>
      </div>
    </section>
    <section class="grid two">
      <div class="panel">
        <h2>创建会话</h2>
        <form id="create-session" class="stack">
          <label>节点
            <select name="node">${nodeViews.map((node) => `<option value="${escapeHtml(node.name)}">${escapeHtml(node.name)}</option>`).join("")}</select>
          </label>
          <label>名称 <input name="name" placeholder="codex-main" required pattern="[A-Za-z0-9_.:-]{1,80}"></label>
          <label>工作目录 <input name="cwd" value="${escapeHtml(process.cwd())}" required></label>
          <label>命令 <input name="command" value="bash" required></label>
          <button type="submit">创建</button>
          <p id="create-status" class="muted"></p>
        </form>
      </div>
      <div class="panel">
        <h2>节点状态</h2>
        <div class="node-list">${nodeViews.map(renderNodeBadge).join("")}</div>
      </div>
    </section>
    <section class="panel">
      <h2>当前会话</h2>
      <table>
        <thead><tr><th>标识</th><th>状态</th><th>目录</th><th>命令</th><th>更新时间</th><th></th></tr></thead>
        <tbody>
          ${rows.length ? rows.map(({ node, session }) => renderSessionRow(node, session)).join("") : `<tr><td colspan="6" class="empty">没有找到会话。</td></tr>`}
        </tbody>
      </table>
    </section>
    <script>
      document.querySelector("#create-session").addEventListener("submit", async (event) => {
        event.preventDefault();
        const status = document.querySelector("#create-status");
        const data = Object.fromEntries(new FormData(event.currentTarget).entries());
        status.textContent = "正在创建...";
        const response = await fetch("/api/sessions", {
          method: "POST",
          headers: {"content-type": "application/json"},
          body: JSON.stringify(data)
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          status.textContent = body.detail || "创建失败";
          return;
        }
        location.href = "/sessions/" + encodeURIComponent(data.node) + "/" + encodeURIComponent(data.name);
      });
    </script>
  `);
}

export function renderNodesPage(nodeViews) {
  return page("节点", `
    <section class="hero">
      <div>
        <h1>节点</h1>
        <p>添加 Hub 可以访问到的机器，可以走 LAN、Tailscale、WireGuard 或 SSH 隧道。</p>
      </div>
    </section>
    <section class="grid two">
      <div class="panel">
        <h2>添加节点</h2>
        <form id="add-node" class="stack">
          <label>名称 <input name="name" placeholder="devbox" required pattern="[A-Za-z0-9_.:-]{1,80}"></label>
          <label>地址 <input name="url" placeholder="http://100.x.x.x:8091" required></label>
          <label>模式 <input name="mode" value="remote"></label>
          <button type="submit">添加节点</button>
          <p id="node-status" class="muted"></p>
        </form>
      </div>
      <div class="panel">
        <h2>已配置节点</h2>
        <table>
          <thead><tr><th>名称</th><th>状态</th><th>地址</th><th>会话数</th><th></th></tr></thead>
          <tbody>${nodeViews.map(renderNodeRow).join("")}</tbody>
        </table>
      </div>
    </section>
    <script>
      document.querySelector("#add-node").addEventListener("submit", async (event) => {
        event.preventDefault();
        const status = document.querySelector("#node-status");
        const data = Object.fromEntries(new FormData(event.currentTarget).entries());
        status.textContent = "正在添加...";
        const response = await fetch("/api/nodes", {
          method: "POST",
          headers: {"content-type": "application/json"},
          body: JSON.stringify(data)
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          status.textContent = body.detail || "添加失败";
          return;
        }
        location.reload();
      });
      async function removeNode(name) {
        if (!confirm("移除节点 " + name + "？")) return;
        await fetch("/api/nodes/" + encodeURIComponent(name), {method: "DELETE"});
        location.reload();
      }
    </script>
  `);
}

export function renderSessionPage({ node, name, windows = [], selectedWindow = "", output }) {
  const activeWindow = selectedWindow || String((windows.find((item) => item.active) || windows[0] || {}).index ?? "");
  return page(`${node.name}/${name}`, `
    <section class="hero compact">
      <div>
        <p><a href="/sessions">返回会话列表</a></p>
        <h1>${escapeHtml(node.name)}/${escapeHtml(name)}</h1>
        <p>${escapeHtml(node.url)} · HTTP 轮询终端</p>
      </div>
      <button id="stop-session" class="danger">停止</button>
    </section>
    <section class="panel terminal-panel">
      <div class="window-tabs">
        ${windows.length ? windows.map((windowItem) => renderWindowTab(node, name, windowItem, activeWindow)).join("") : `<span class="muted">没有找到窗口</span>`}
      </div>
      <div class="terminal-toolbar">
        <div class="view-tabs">
          <button class="view-tab is-active" type="button" data-view="chat">Chat</button>
          <button class="view-tab" type="button" data-view="terminal">Terminal</button>
        </div>
        <span class="muted">Chat 是从 tmux 输出临时整理出来的视图</span>
      </div>
      <div id="chat-view" class="chat-view"></div>
      <pre id="terminal" class="is-hidden" data-initial-output="${escapeHtml(output)}"></pre>
      <form id="send-message" class="terminal-input">
        <input name="text" autocomplete="off" autofocus placeholder="输入一行内容后按回车">
        <button type="submit">发送</button>
      </form>
      <p id="send-status" class="muted"></p>
    </section>
    <script>
      const node = ${JSON.stringify(node.name)};
      const name = ${JSON.stringify(name)};
      const activeWindow = ${JSON.stringify(activeWindow)};
      const terminal = document.querySelector("#terminal");
      const chatView = document.querySelector("#chat-view");
      const storageKey = "tmuxfleet.sent." + node + "." + name + "." + activeWindow;
      let sentMessages = loadSentMessages();
      let pendingSentMessages = [];
      let latestOutput = terminal.dataset.initialOutput || "";
      let autoscroll = true;

      renderViews(latestOutput);
      terminal.addEventListener("scroll", () => {
        autoscroll = terminal.scrollTop + terminal.clientHeight >= terminal.scrollHeight - 20;
      });
      chatView.addEventListener("scroll", () => {
        autoscroll = chatView.scrollTop + chatView.clientHeight >= chatView.scrollHeight - 20;
      });
      for (const button of document.querySelectorAll(".view-tab")) {
        button.addEventListener("click", () => switchView(button.dataset.view));
      }

      async function refreshOutput() {
        const query = new URLSearchParams({lines: "500"});
        if (activeWindow !== "") query.set("window", activeWindow);
        const response = await fetch("/api/sessions/" + encodeURIComponent(node) + "/" + encodeURIComponent(name) + "/output?" + query.toString());
        if (!response.ok) return;
        const body = await response.json();
        latestOutput = body.output || "";
        renderViews(latestOutput);
        if (autoscroll) {
          terminal.scrollTop = terminal.scrollHeight;
          chatView.scrollTop = chatView.scrollHeight;
        }
      }

      function renderViews(output) {
        terminal.textContent = output;
        renderChat(output);
      }

      function switchView(view) {
        const isChat = view !== "terminal";
        chatView.classList.toggle("is-hidden", !isChat);
        terminal.classList.toggle("is-hidden", isChat);
        for (const button of document.querySelectorAll(".view-tab")) {
          button.classList.toggle("is-active", button.dataset.view === (isChat ? "chat" : "terminal"));
        }
        if (autoscroll) {
          terminal.scrollTop = terminal.scrollHeight;
          chatView.scrollTop = chatView.scrollHeight;
        }
      }

      function renderChat(output) {
        const messages = buildChatMessages(output);
        if (!messages.length) {
          chatView.innerHTML = '<div class="chat-empty">还没有可整理成 Chat 的输出。切到 Terminal 可以看原始内容。</div>';
          return;
        }
        chatView.innerHTML = messages.map(renderMessage).join("");
      }

      function buildChatMessages(output) {
        const messages = [];
        let agentLines = [];
        const matchedSentMessages = new Set();
        for (const rawLine of String(output || "").split("\\n")) {
          const line = cleanTerminalLine(rawLine);
          if (!line) continue;
          const sent = matchingSentMessage(line);
          if (sent) {
            matchedSentMessages.add(sent);
            flushAgent();
            messages.push({role: "user", text: sent});
            continue;
          }
          if (isPromptLine(line) || isShellEcho(line)) continue;
          agentLines.push(line);
        }
        flushAgent();
        pendingSentMessages = pendingSentMessages.filter((message) => !matchedSentMessages.has(message));
        for (const message of pendingSentMessages) {
          messages.push({role: "user", text: message});
        }
        return compactMessages(messages).slice(-80);

        function flushAgent() {
          const text = agentLines.join("\\n").trim();
          agentLines = [];
          if (text) messages.push({role: "agent", text});
        }
      }

      function renderMessage(message) {
        const roleLabel = message.role === "user" ? "我" : "Agent";
        return '<article class="chat-message ' + message.role + '">' +
          '<div class="chat-role">' + roleLabel + '</div>' +
          '<div class="chat-bubble">' + escapeHtml(message.text) + '</div>' +
        '</article>';
      }

      function compactMessages(messages) {
        const result = [];
        for (const message of messages) {
          const previous = result[result.length - 1];
          if (previous && previous.role === message.role && message.role === "agent") {
            previous.text = previous.text + "\\n" + message.text;
          } else {
            result.push({...message});
          }
        }
        return result;
      }

      function matchingSentMessage(line) {
        const trimmed = line.trim();
        for (let index = sentMessages.length - 1; index >= 0; index -= 1) {
          const message = sentMessages[index];
          if (message && trimmed.includes(message)) return message;
        }
        return "";
      }

      function cleanTerminalLine(line) {
        return String(line || "")
          .replace(/\\u001b\\[[0-9;?]*[ -/]*[@-~]/g, "")
          .replace(/\\r/g, "")
          .trimEnd();
      }

      function isPromptLine(line) {
        const trimmed = line.trim();
        return /^(root|[\\w.-]+)@[^\\s]+:.*[#>$]\\s*$/.test(trimmed) ||
          /^[^\\s]+[#>$]\\s*$/.test(trimmed);
      }

      function isShellEcho(line) {
        const trimmed = line.trim();
        return /^[^\\s].*[#$>]\\s+(printf|echo|cd|ls|pwd|cat|node|npm|python|python3|git|tmux|codex|claude|gemini|opencode|bash)\\b/.test(trimmed);
      }

      function loadSentMessages() {
        try {
          const raw = JSON.parse(localStorage.getItem(storageKey) || "[]");
          return Array.isArray(raw) ? raw.slice(-80) : [];
        } catch {
          return [];
        }
      }

      function rememberSentMessage(text) {
        sentMessages = sentMessages.concat([text]).slice(-80);
        localStorage.setItem(storageKey, JSON.stringify(sentMessages));
      }

      function escapeHtml(value) {
        return String(value)
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;");
      }

      document.querySelector("#send-message").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const input = event.currentTarget.elements.text;
        const button = form.querySelector("button[type='submit']");
        const status = document.querySelector("#send-status");
        const text = input.value;
        if (!text.trim()) return;
        input.value = "";
        input.disabled = true;
        button.disabled = true;
        status.textContent = "正在发送...";
        pendingSentMessages.push(text);
        rememberSentMessage(text);
        renderViews(latestOutput);
        if (autoscroll) {
          terminal.scrollTop = terminal.scrollHeight;
          chatView.scrollTop = chatView.scrollHeight;
        }
        try {
          const response = await fetch("/api/sessions/" + encodeURIComponent(node) + "/" + encodeURIComponent(name) + "/send", {
            method: "POST",
            headers: {"content-type": "application/json"},
            body: JSON.stringify({text, window: activeWindow})
          });
          const body = await response.json().catch(() => ({}));
          status.textContent = response.ok ? "已发送，等待输出..." : (body.detail || "发送失败");
          setTimeout(refreshOutput, 120);
        } catch (error) {
          status.textContent = "发送失败：" + (error.message || String(error));
        } finally {
          input.disabled = false;
          button.disabled = false;
          input.focus();
        }
      });
      document.querySelector("#stop-session").addEventListener("click", async () => {
        if (!confirm("停止 " + node + "/" + name + "？")) return;
        await fetch("/api/sessions/" + encodeURIComponent(node) + "/" + encodeURIComponent(name), {method: "DELETE"});
        location.href = "/sessions";
      });
      setInterval(refreshOutput, 1000);
      terminal.scrollTop = terminal.scrollHeight;
    </script>
  `);
}

function renderWindowTab(node, sessionName, windowItem, activeWindow) {
  const index = String(windowItem.index);
  const href = `/sessions/${encodeURIComponent(node.name)}/${encodeURIComponent(sessionName)}?window=${encodeURIComponent(index)}`;
  const label = `${index}: ${windowItem.name || "window"}`;
  const meta = `${windowItem.panes || 0} 个 pane`;
  return `<a class="window-tab ${index === activeWindow ? "is-active" : ""}" href="${href}">
    <strong>${escapeHtml(label)}</strong>
    <span>${escapeHtml(meta)}</span>
  </a>`;
}

function renderSessionRow(node, session) {
  const href = `/sessions/${encodeURIComponent(node.name)}/${encodeURIComponent(session.name)}`;
  return `<tr>
    <td><a href="${href}">${escapeHtml(node.name)}/${escapeHtml(session.name)}</a></td>
    <td><span class="pill">${escapeHtml(displayStatus(session.status))}</span></td>
    <td class="path">${escapeHtml(session.cwd || "-")}</td>
    <td>${escapeHtml(session.command || "-")}</td>
    <td>${escapeHtml(relativeTime(session.lastUpdated))}</td>
    <td><a class="button-link" href="${href}">打开</a></td>
  </tr>`;
}

function renderNodeRow(node) {
  const canRemove = node.name !== "local" && node.mode !== "connected";
  return `<tr>
    <td>${escapeHtml(node.name)}</td>
    <td><span class="pill ${node.status === "connected" ? "ok" : "bad"}">${escapeHtml(displayStatus(node.status))}</span></td>
    <td class="path">${escapeHtml(node.url)}</td>
    <td>${node.sessions.length}</td>
    <td>${canRemove ? `<button class="ghost danger-text" onclick="removeNode('${escapeJs(node.name)}')">移除</button>` : ""}</td>
  </tr>`;
}

function renderNodeBadge(node) {
  return `<div class="node-badge">
    <strong>${escapeHtml(node.name)}</strong>
    <span class="${node.status === "connected" ? "ok-text" : "bad-text"}">${escapeHtml(displayStatus(node.status))}</span>
    <small>${escapeHtml(node.sessions.length)} 个会话</small>
  </div>`;
}

function relativeTime(value) {
  if (!value) return "-";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function displayStatus(value) {
  const map = {
    connected: "已连接",
    disconnected: "未连接",
    attached: "已附加",
    detached: "后台运行",
    created: "已创建",
    stopped: "已停止"
  };
  return map[value] || value || "-";
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeJs(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

function styles() {
  return `
    :root { color-scheme: light; --bg: #f6f8fb; --panel: #fff; --text: #182230; --muted: #667085; --line: #d9e0ea; --blue: #1769e0; --green: #157347; --red: #b42318; }
    * { box-sizing: border-box; }
    body { margin: 0; font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--text); background: var(--bg); }
    header { height: 56px; display: flex; align-items: center; gap: 22px; padding: 0 24px; background: #fff; border-bottom: 1px solid var(--line); position: sticky; top: 0; z-index: 1; }
    .brand { font-weight: 700; color: var(--text); text-decoration: none; }
    nav { display: flex; gap: 14px; flex: 1; }
    nav a, a { color: var(--blue); text-decoration: none; }
    main { max-width: 1180px; margin: 0 auto; padding: 24px; }
    main.session-main { max-width: 1600px; padding: 18px 24px 24px; }
    h1, h2 { margin: 0; line-height: 1.2; }
    h1 { font-size: 28px; }
    h2 { font-size: 17px; margin-bottom: 16px; }
    p { margin: 8px 0 0; color: var(--muted); }
    .hero { display: flex; justify-content: space-between; align-items: end; gap: 16px; margin-bottom: 20px; }
    .hero.compact { align-items: center; }
    .grid.two { display: grid; grid-template-columns: minmax(320px, 0.8fr) 1.2fr; gap: 18px; margin-bottom: 18px; }
    .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 18px; box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04); }
    .panel.narrow { max-width: 420px; margin: 80px auto; }
    .stack { display: grid; gap: 12px; }
    label { display: grid; gap: 6px; color: #344054; font-weight: 600; }
    input, select, button { font: inherit; }
    input, select { width: 100%; border: 1px solid #cbd5e1; border-radius: 6px; padding: 9px 10px; background: #fff; color: var(--text); }
    button, .button-link { border: 0; border-radius: 6px; padding: 9px 12px; background: var(--blue); color: #fff; cursor: pointer; text-decoration: none; display: inline-block; }
    button.ghost { background: transparent; color: var(--blue); padding: 6px 8px; }
    button.danger { background: var(--red); }
    .danger-text { color: var(--red) !important; }
    .muted, .empty { color: var(--muted); }
    .error, .bad-text { color: var(--red); }
    .ok-text { color: var(--green); }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; border-bottom: 1px solid #edf1f6; padding: 10px 8px; vertical-align: top; }
    th { color: #475467; font-size: 12px; text-transform: uppercase; letter-spacing: 0; }
    .path { max-width: 420px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #475467; }
    .pill { display: inline-block; border-radius: 999px; background: #eef2f7; color: #344054; padding: 2px 8px; font-size: 12px; }
    .pill.ok { background: #dcfae6; color: #067647; }
    .pill.bad { background: #fee4e2; color: #b42318; }
    .node-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; }
    .node-badge { border: 1px solid var(--line); border-radius: 8px; padding: 12px; display: grid; gap: 2px; }
    .terminal-panel { padding: 0; overflow: hidden; }
    .window-tabs { display: flex; gap: 8px; overflow-x: auto; padding: 10px 12px; border-bottom: 1px solid var(--line); background: #fff; }
    .window-tab { min-width: 120px; border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; color: var(--text); display: grid; gap: 2px; text-decoration: none; }
    .window-tab span { color: var(--muted); font-size: 12px; }
    .window-tab.is-active { border-color: var(--blue); box-shadow: inset 0 0 0 1px var(--blue); }
    .terminal-toolbar { height: 42px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 12px; border-bottom: 1px solid var(--line); background: #f8fafc; color: #344054; font-weight: 600; }
    .view-tabs { display: inline-flex; gap: 4px; padding: 3px; border: 1px solid var(--line); border-radius: 8px; background: #fff; }
    .view-tab { background: transparent; color: #475467; padding: 5px 10px; border-radius: 6px; }
    .view-tab.is-active { background: #e8f1ff; color: #155eef; }
    .is-hidden { display: none !important; }
    .chat-view { height: calc(100vh - 238px); min-height: 560px; overflow: auto; padding: 22px; background: #f8fafc; }
    .chat-empty { max-width: 520px; margin: 80px auto; text-align: center; color: var(--muted); }
    .chat-message { display: grid; gap: 6px; margin: 0 0 18px; max-width: min(860px, 86%); }
    .chat-message.user { margin-left: auto; justify-items: end; }
    .chat-message.agent { margin-right: auto; justify-items: start; }
    .chat-role { font-size: 12px; color: #667085; font-weight: 700; padding: 0 4px; }
    .chat-bubble { border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; white-space: pre-wrap; word-break: break-word; box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04); }
    .chat-message.user .chat-bubble { background: #155eef; color: #fff; border-color: #155eef; }
    .chat-message.agent .chat-bubble { background: #fff; color: #182230; }
    #terminal { margin: 0; height: calc(100vh - 238px); min-height: 560px; overflow: auto; padding: 16px; background: #101828; color: #e4e7ec; font: 13px/1.45 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; white-space: pre-wrap; }
    .terminal-input { display: grid; grid-template-columns: 1fr auto; gap: 10px; padding: 12px; border-top: 1px solid var(--line); background: #fff; }
    @media (max-width: 760px) { main, main.session-main { padding: 16px; } .grid.two { grid-template-columns: 1fr; } header { padding: 0 14px; } .hero { display: grid; } .path { max-width: 220px; } .terminal-toolbar { height: auto; align-items: start; flex-direction: column; padding: 10px 12px; } #terminal, .chat-view { height: calc(100vh - 280px); min-height: 420px; } .chat-message { max-width: 94%; } }
  `;
}
