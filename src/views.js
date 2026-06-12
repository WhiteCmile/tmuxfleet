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
  const visible = rows.filter(({ session }) => !session.hidden);
  const hidden = rows.filter(({ session }) => session.hidden);
  return page("会话", `
    <section class="hero">
      <div>
        <h1>会话</h1>
        <p>已配置 ${nodeViews.length} 个节点，${visible.length} 个可见会话${hidden.length ? `，${hidden.length} 个已隐藏` : ""}。</p>
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
      <div class="table-wrap"><table>
        <thead><tr><th>标识</th><th>状态</th><th class="opt-col">目录</th><th class="opt-col">命令</th><th>更新时间</th><th>自动恢复</th><th></th><th></th></tr></thead>
        <tbody>
          ${visible.length ? visible.map(({ node, session }) => renderSessionRow(node, session)).join("") : `<tr><td colspan="8" class="empty">没有可见会话。</td></tr>`}
        </tbody>
      </table></div>
    </section>
    ${hidden.length ? `
    <section class="panel">
      <details class="hidden-sessions">
        <summary><h2 style="display:inline;cursor:pointer;margin-bottom:0">已隐藏 (${hidden.length})</h2></summary>
        <div class="table-wrap" style="margin-top:14px"><table>
          <thead><tr><th>标识</th><th>状态</th><th class="opt-col">目录</th><th class="opt-col">命令</th><th>更新时间</th><th>自动恢复</th><th></th><th></th></tr></thead>
          <tbody>${hidden.map(({ node, session }) => renderSessionRow(node, session)).join("")}</tbody>
        </table></div>
      </details>
    </section>
    ` : ""}
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
      for (const button of document.querySelectorAll(".toggle-vis")) {
        button.addEventListener("click", async () => {
          const node = button.dataset.node;
          const session = button.dataset.session;
          const hidden = button.dataset.hidden === "1";
          button.disabled = true;
          button.textContent = "...";
          await fetch("/api/sessions/" + encodeURIComponent(node) + "/" + encodeURIComponent(session) + "/hide", {
            method: "PUT",
            headers: {"content-type": "application/json"},
            body: JSON.stringify({hidden: !hidden})
          });
          location.reload();
        });
      }
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
        <div class="table-wrap"><table>
          <thead><tr><th>名称</th><th>状态</th><th class="opt-col">地址</th><th>会话数</th><th></th></tr></thead>
          <tbody>${nodeViews.map(renderNodeRow).join("")}</tbody>
        </table></div>
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

function stripTerminalCodes(value) {
  return String(value || "")
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/\x1b\][^\x07]*\x07/g, "")
    .replace(/\r/g, "");
}

function splitChatBlocks(output) {
  const text = stripTerminalCodes(output).trimEnd();
  if (!text.trim()) return [];
  const lines = text.split("\n");
  const blocks = [];
  let current = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const startsPrompt = /^(>|\$|#|❯|➜)\s+/.test(trimmed) || /^\[?(user|assistant|system|tool|error)\]?[:：]/i.test(trimmed);
    if ((startsPrompt || trimmed === "") && current.some((item) => item.trim())) {
      blocks.push(current.join("\n").trimEnd());
      current = [];
      if (trimmed === "") continue;
    }
    current.push(line);
  }
  if (current.some((item) => item.trim())) blocks.push(current.join("\n").trimEnd());
  return blocks.slice(-80);
}

function chatRole(block) {
  const first = block.trimStart().split("\n")[0] || "";
  if (/^(>|\$|#|❯|➜)\s+/.test(first) || /^\[?user\]?[:：]/i.test(first)) return "user";
  if (/error|failed|exception|traceback|timed out|connection/i.test(first)) return "error";
  if (/^\[?(system|tool)\]?[:：]/i.test(first)) return "system";
  return "agent";
}

function renderChatMessages(output) {
  const blocks = splitChatBlocks(output);
  if (!blocks.length) return `<div class="empty chat-empty">暂无输出</div>`;
  return blocks.map((block) => {
    const role = chatRole(block);
    const label = role === "user" ? "Input" : role === "error" ? "Error" : role === "system" ? "System" : "Output";
    return `<article class="chat-message ${role}">
      <div class="chat-role">${label}</div>
      <pre>${escapeHtml(block)}</pre>
    </article>`;
  }).join("");
}

export function renderSessionPage({ node, name, windows = [], selectedWindow = "", output, autoRecoverConfig = null }) {
  const activeWindow = selectedWindow || String((windows.find((item) => item.active) || windows[0] || {}).index ?? "");
  const autoRecoverEnabled = !!autoRecoverConfig;
  const autoRecoverWindow = autoRecoverEnabled ? String(autoRecoverConfig.window ?? "") : "";
  const autoRecoverOnActiveWindow = autoRecoverEnabled && autoRecoverWindow === activeWindow;
  const autoRecoverLabel = autoRecoverOnActiveWindow ? "关闭自动恢复" : "开启自动恢复";
  const smartRecoverEnabled = autoRecoverEnabled && !!autoRecoverConfig.smart;
  const smartRecoverLabel = smartRecoverEnabled ? "关闭智能恢复" : "开启智能恢复";
  const autoRecoverStatus = autoRecoverEnabled
    ? `规则恢复：window ${autoRecoverWindow || "默认"} · ${autoRecoverConfig.message || "go on"} · 智能恢复${smartRecoverEnabled ? "已开启" : "未开启"}`
    : "未开启";
  return page(`${node.name}/${name}`, `
    <section class="hero compact">
      <div>
        <p><a href="/sessions">返回会话列表</a></p>
        <h1>${escapeHtml(node.name)}/${escapeHtml(name)}</h1>
        <p>${escapeHtml(node.url)} · Chat log view</p>
      </div>
      <button id="stop-session" class="danger">停止</button>
    </section>
    <section class="panel terminal-panel">
      <div class="window-tabs">
        ${windows.length ? windows.map((windowItem) => renderWindowTab(node, name, windowItem, activeWindow)).join("") : `<span class="muted">没有找到窗口</span>`}
      </div>
      <div class="terminal-tools">
        <span id="autorecover-status">${escapeHtml(autoRecoverStatus)}</span>
        <span class="terminal-actions">
          <button id="toggle-autorecover" class="ghost" type="button">${escapeHtml(autoRecoverLabel)}</button>
          <button id="toggle-smartrecover" class="ghost" type="button">${escapeHtml(smartRecoverLabel)}</button>
        </span>
      </div>
      <div id="chat-log" class="chat-log" tabindex="0">${renderChatMessages(output)}</div>
      <form id="send-message" class="chat-input">
        <input name="text" autocomplete="off" autofocus placeholder="输入一行内容后按回车">
        <button type="submit">发送</button>
      </form>
      <p id="send-status" class="muted"></p>
    </section>
    <script>
      const node = ${JSON.stringify(node.name)};
      const name = ${JSON.stringify(name)};
      const activeWindow = ${JSON.stringify(activeWindow)};
      let autoRecoverOnActiveWindow = ${JSON.stringify(autoRecoverOnActiveWindow)};
      let smartRecoverEnabled = ${JSON.stringify(smartRecoverEnabled)};
      const chatLog = document.querySelector("#chat-log");
      let autoscroll = true;

      chatLog.addEventListener("scroll", () => {
        autoscroll = chatLog.scrollTop + chatLog.clientHeight >= chatLog.scrollHeight - 20;
      });
      chatLog.addEventListener("keydown", (event) => {
        const keyScroll = {
          PageUp: -chatLog.clientHeight * 0.9,
          PageDown: chatLog.clientHeight * 0.9,
          ArrowUp: -24,
          ArrowDown: 24,
        }[event.key];
        if (keyScroll !== undefined) {
          event.preventDefault();
          chatLog.scrollTop += keyScroll;
        } else if (event.key === "Home") {
          event.preventDefault();
          chatLog.scrollTop = 0;
        } else if (event.key === "End") {
          event.preventDefault();
          chatLog.scrollTop = chatLog.scrollHeight;
        } else {
          return;
        }
        autoscroll = chatLog.scrollTop + chatLog.clientHeight >= chatLog.scrollHeight - 20;
      });

      function stripTerminalCodes(value) {
        const ESC = String.fromCharCode(27);
        const BEL = String.fromCharCode(7);
        return String(value || "")
          .replace(new RegExp(ESC + "\\\\[[0-9;?]*[A-Za-z]", "g"), "")
          .replace(new RegExp(ESC + "\\\\][^" + BEL + "]*" + BEL, "g"), "")
          .replace(/\\r/g, "");
      }

      function escapeText(value) {
        return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
      }

      function splitChatBlocks(output) {
        const text = stripTerminalCodes(output).trimEnd();
        if (!text.trim()) return [];
        const lines = text.split("\\n");
        const blocks = [];
        let current = [];
        for (const line of lines) {
          const trimmed = line.trim();
          const startsPrompt = /^(>|\\$|#|❯|➜)\\s+/.test(trimmed) || /^\\[?(user|assistant|system|tool|error)\\]?[:：]/i.test(trimmed);
          if ((startsPrompt || trimmed === "") && current.some((item) => item.trim())) {
            blocks.push(current.join("\\n").trimEnd());
            current = [];
            if (trimmed === "") continue;
          }
          current.push(line);
        }
        if (current.some((item) => item.trim())) blocks.push(current.join("\\n").trimEnd());
        return blocks.slice(-80);
      }

      function blockRole(block) {
        const first = block.trimStart().split("\\n")[0] || "";
        if (/^(>|\\$|#|❯|➜)\\s+/.test(first) || /^\\[?user\\]?[:：]/i.test(first)) return "user";
        if (/error|failed|exception|traceback|timed out|connection/i.test(first)) return "error";
        if (/^\\[?(system|tool)\\]?[:：]/i.test(first)) return "system";
        return "agent";
      }

      function renderChat(output) {
        const blocks = splitChatBlocks(output);
        if (!blocks.length) {
          return '<div class="empty chat-empty">暂无输出</div>';
        }
        return blocks.map((block) => {
          const role = blockRole(block);
          const label = role === "user" ? "Input" : role === "error" ? "Error" : role === "system" ? "System" : "Output";
          return '<article class="chat-message ' + role + '"><div class="chat-role">' + label + '</div><pre>' + escapeText(block) + '</pre></article>';
        }).join("");
      }

      async function refreshOutput() {
        try {
        const query = new URLSearchParams({lines: "2000"});
        if (activeWindow !== "") query.set("window", activeWindow);
        const response = await fetch("/api/sessions/" + encodeURIComponent(node) + "/" + encodeURIComponent(name) + "/output?" + query.toString());
        if (!response.ok) return;
        const body = await response.json();
        if (body.inMode) return;
        const previousScrollTop = chatLog.scrollTop;
        chatLog.innerHTML = renderChat(body.output || "");
        if (autoscroll) {
          chatLog.scrollTop = chatLog.scrollHeight;
        } else {
          chatLog.scrollTop = previousScrollTop;
        }
        } catch(e) { chatLog.innerHTML = '<div class="error">[refresh error] ' + escapeText(e.message || String(e)) + '</div>'; }
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
      document.querySelector("#toggle-autorecover").addEventListener("click", async (event) => {
        const button = event.currentTarget;
        const status = document.querySelector("#autorecover-status");
        button.disabled = true;
        status.textContent = autoRecoverOnActiveWindow ? "正在关闭..." : "正在开启...";
        try {
          const response = await fetch("/api/sessions/" + encodeURIComponent(node) + "/" + encodeURIComponent(name) + "/autorecover", {
            method: "PUT",
            headers: {"content-type": "application/json"},
            body: JSON.stringify({enabled: !autoRecoverOnActiveWindow, window: activeWindow, message: "go on", smart: smartRecoverEnabled && !autoRecoverOnActiveWindow})
          });
          const body = await response.json().catch(() => ({}));
          if (!response.ok) {
            status.textContent = body.detail || "更新失败";
            return;
          }
          autoRecoverOnActiveWindow = !autoRecoverOnActiveWindow;
          if (!autoRecoverOnActiveWindow) smartRecoverEnabled = false;
          button.textContent = autoRecoverOnActiveWindow ? "关闭自动恢复" : "开启自动恢复";
          document.querySelector("#toggle-smartrecover").textContent = smartRecoverEnabled ? "关闭智能恢复" : "开启智能恢复";
          status.textContent = autoRecoverOnActiveWindow
            ? ("规则恢复：window " + (activeWindow || "默认") + " · go on · 智能恢复" + (smartRecoverEnabled ? "已开启" : "未开启"))
            : "未开启";
        } catch (error) {
          status.textContent = "更新失败：" + (error.message || String(error));
        } finally {
          button.disabled = false;
        }
      });
      document.querySelector("#toggle-smartrecover").addEventListener("click", async (event) => {
        const button = event.currentTarget;
        const status = document.querySelector("#autorecover-status");
        button.disabled = true;
        const nextSmart = !smartRecoverEnabled;
        status.textContent = nextSmart ? "正在开启智能恢复..." : "正在关闭智能恢复...";
        try {
          const response = await fetch("/api/sessions/" + encodeURIComponent(node) + "/" + encodeURIComponent(name) + "/autorecover", {
            method: "PUT",
            headers: {"content-type": "application/json"},
            body: JSON.stringify({enabled: true, window: activeWindow, message: "go on", smart: nextSmart})
          });
          const body = await response.json().catch(() => ({}));
          if (!response.ok) {
            status.textContent = body.detail || "更新失败";
            return;
          }
          autoRecoverOnActiveWindow = true;
          smartRecoverEnabled = nextSmart;
          document.querySelector("#toggle-autorecover").textContent = "关闭自动恢复";
          button.textContent = smartRecoverEnabled ? "关闭智能恢复" : "开启智能恢复";
          status.textContent = "规则恢复：window " + (activeWindow || "默认") + " · go on · 智能恢复" + (smartRecoverEnabled ? "已开启" : "未开启");
        } catch (error) {
          status.textContent = "更新失败：" + (error.message || String(error));
        } finally {
          button.disabled = false;
        }
      });
      refreshOutput();
      setInterval(refreshOutput, 1000);
      chatLog.scrollTop = chatLog.scrollHeight;
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
  const toggleLabel = session.hidden ? "显示" : "隐藏";
  const toggleTitle = session.hidden ? "恢复显示此会话" : "隐藏此会话";
  return `<tr>
    <td><a href="${href}">${escapeHtml(node.name)}/${escapeHtml(session.name)}</a></td>
    <td><span class="pill">${escapeHtml(displayStatus(session.status))}</span></td>
    <td class="path opt-col">${escapeHtml(session.cwd || "-")}</td>
    <td class="opt-col">${escapeHtml(session.command || "-")}</td>
    <td>${escapeHtml(relativeTime(session.lastUpdated))}</td>
    <td>${session.autoRecover ? `<span class="pill ok">已开启</span>` : `<span class="muted">-</span>`}</td>
    <td><a class="button-link" href="${href}">打开</a></td>
    <td><button class="ghost toggle-vis" type="button" data-node="${escapeHtml(node.name)}" data-session="${escapeHtml(session.name)}" data-hidden="${session.hidden ? "1" : "0"}" title="${toggleTitle}">${toggleLabel}</button></td>
  </tr>`;
}

function renderNodeRow(node) {
  const canRemove = node.name !== "local" && node.mode !== "connected";
  return `<tr>
    <td>${escapeHtml(node.name)}</td>
    <td><span class="pill ${node.status === "connected" ? "ok" : "bad"}">${escapeHtml(displayStatus(node.status))}</span></td>
    <td class="path opt-col">${escapeHtml(node.url)}</td>
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
    .brand { font-weight: 700; color: var(--text); text-decoration: none; white-space: nowrap; }
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
    .grid.two { display: grid; grid-template-columns: minmax(280px, 0.8fr) 1.2fr; gap: 18px; margin-bottom: 18px; }
    .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 18px; box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04); }
    .panel.narrow { max-width: 420px; margin: 80px auto; }
    .stack { display: grid; gap: 12px; }
    label { display: grid; gap: 6px; color: #344054; font-weight: 600; }
    input, select, button { font: inherit; }
    input, select { width: 100%; border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px 12px; background: #fff; color: var(--text); }
    button, .button-link { border: 0; border-radius: 6px; padding: 10px 16px; min-height: 44px; background: var(--blue); color: #fff; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; }
    button.ghost { background: transparent; color: var(--blue); padding: 8px 10px; min-height: 44px; }
    button.danger { background: var(--red); }
    .danger-text { color: var(--red) !important; }
    .muted, .empty { color: var(--muted); }
    .error, .bad-text { color: var(--red); }
    .ok-text { color: var(--green); }
    .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
    table { width: 100%; border-collapse: collapse; min-width: 480px; }
    th, td { text-align: left; border-bottom: 1px solid #edf1f6; padding: 10px 8px; vertical-align: top; }
    th { color: #475467; font-size: 12px; text-transform: uppercase; letter-spacing: 0; white-space: nowrap; }
    .path { max-width: 420px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #475467; }
    .pill { display: inline-block; border-radius: 999px; background: #eef2f7; color: #344054; padding: 2px 8px; font-size: 12px; white-space: nowrap; }
    .pill.ok { background: #dcfae6; color: #067647; }
    .pill.bad { background: #fee4e2; color: #b42318; }
    .node-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; }
    .node-badge { border: 1px solid var(--line); border-radius: 8px; padding: 12px; display: grid; gap: 2px; }
    .terminal-panel { padding: 0; overflow: hidden; }
    .window-tabs { display: flex; gap: 8px; overflow-x: auto; -webkit-overflow-scrolling: touch; padding: 10px 12px; border-bottom: 1px solid var(--line); background: #fff; }
    .window-tab { min-width: 120px; border: 1px solid var(--line); border-radius: 6px; padding: 10px 12px; color: var(--text); display: grid; gap: 2px; text-decoration: none; }
    .window-tab span { color: var(--muted); font-size: 12px; }
    .window-tab.is-active { border-color: var(--blue); box-shadow: inset 0 0 0 1px var(--blue); }
    .terminal-tools { min-height: 48px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 12px; border-bottom: 1px solid var(--line); background: #fbfcfe; color: var(--muted); }
    .terminal-actions { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
    .chat-log { height: calc(100vh - 238px); min-height: 560px; overflow: auto; overscroll-behavior: contain; display: grid; align-content: start; gap: 12px; padding: 16px; background: #f3f5f8; }
    .chat-message { max-width: 980px; border: 1px solid #d7dee8; border-radius: 8px; padding: 10px 12px; background: #fff; }
    .chat-message.user { justify-self: end; background: #e8f1ff; border-color: #b8d4ff; }
    .chat-message.error { border-color: #f2b8b5; background: #fff0f0; }
    .chat-message.system { background: #f7f7f8; }
    .chat-role { color: #667085; font-size: 12px; font-weight: 700; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0; }
    .chat-message pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; color: #182230; font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    .chat-empty { padding: 20px; }
    .chat-input { display: grid; grid-template-columns: 1fr auto; gap: 10px; padding: 12px; border-top: 1px solid var(--line); background: #fff; }

    @media (max-width: 760px) {
      main, main.session-main { padding: 14px; }
      .grid.two { grid-template-columns: 1fr; gap: 14px; }
      header { height: auto; min-height: 50px; gap: 12px; padding: 10px 14px; flex-wrap: wrap; }
      nav { gap: 10px; }
      h1 { font-size: 22px; }
      .hero { display: grid; gap: 12px; }
      .hero.compact button.danger { width: 100%; }
      .panel { padding: 14px; }
      .panel.narrow { max-width: none; margin: 20px auto; }
      .path { max-width: 200px; }
      .node-list { grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); }
      .chat-log { height: calc(100vh - 200px); min-height: 420px; }
    }

    @media (max-width: 480px) {
      body { font-size: 13px; }
      main, main.session-main { padding: 10px; }
      header { gap: 8px; padding: 8px 10px; }
      .brand { font-size: 15px; }
      nav { gap: 8px; font-size: 13px; }
      h1 { font-size: 20px; }
      h2 { font-size: 15px; margin-bottom: 12px; }
      .hero { gap: 8px; margin-bottom: 14px; }
      .grid.two { gap: 10px; margin-bottom: 14px; }
      .panel { padding: 12px; }
      .stack { gap: 10px; }
      label { gap: 4px; }
      .opt-col { display: none; }
      .path { max-width: 140px; }
      .node-list { grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; }
      .node-badge { padding: 10px; }
      .window-tabs { gap: 6px; padding: 8px 10px; }
      .window-tab { min-width: 90px; padding: 8px 10px; font-size: 13px; }
      .terminal-tools { align-items: stretch; display: grid; gap: 6px; }
      .terminal-actions { display: grid; justify-content: stretch; }
      .terminal-tools button { width: 100%; }
      .chat-log { height: calc(100vh - 180px); min-height: 360px; padding: 12px; }
      .chat-message pre { font-size: 12px; }
      .chat-input { gap: 8px; padding: 10px; }
      table { min-width: 360px; }
      th, td { padding: 8px 6px; }
      th { font-size: 11px; }
    }
  `;
}
