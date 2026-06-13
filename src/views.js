export function page(title, body, activeNav = "") {
  const navLink = (href, label, key) =>
    `<a href="${href}"${key === activeNav ? ' class="is-active"' : ""}>${label}</a>`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#f6f8fb" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#0b101c" media="(prefers-color-scheme: dark)">
  <link rel="icon" href="${favicon()}">
  <title>${escapeHtml(title)} · tmuxfleet</title>
  <style>${styles()}</style>
</head>
<body>
  <header>
    <a class="brand" href="/sessions">tmuxfleet</a>
    <nav>
      ${navLink("/sessions", "会话", "sessions")}
      ${navLink("/nodes", "节点", "nodes")}
    </nav>
    <form method="post" action="/logout"><button class="ghost" type="submit">退出</button></form>
  </header>
  <main class="${title.includes("/") ? "session-main" : ""}">${body}</main>
</body>
</html>`;
}

function favicon() {
  const svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>"
    + "<rect width='32' height='32' rx='7' fill='#101828'/>"
    + "<path d='M9 10l7 6-7 6' stroke='#6ea8fe' stroke-width='3' fill='none' stroke-linecap='round' stroke-linejoin='round'/>"
    + "<path d='M19 22h5' stroke='#40d472' stroke-width='3' stroke-linecap='round'/>"
    + "</svg>";
  return "data:image/svg+xml," + encodeURIComponent(svg);
}

export function renderSessionsPage(nodeViews) {
  const sessionTableHead = `<thead><tr><th>标识</th><th>状态</th><th>活动</th><th class="opt-col">目录</th><th>更新时间</th><th>自动恢复</th><th></th></tr></thead>`;
  return page("会话", `
    <section class="hero">
      <div>
        <h1>会话</h1>
        <p id="summary">正在加载...</p>
      </div>
      <div class="hero-actions">
        <span class="live-indicator"><span id="live-dot" class="live-dot"></span><span id="live-text" class="muted">自动刷新中</span></span>
        <button id="toggle-create" type="button">新建会话</button>
      </div>
    </section>
    <div class="node-strip">
      <div class="node-chips" id="node-chips"></div>
      <a href="/nodes">管理节点 →</a>
    </div>
    <section class="panel" id="create-panel" hidden>
      <h2>新建会话</h2>
      <form id="create-session">
        <div class="form-row">
          <label>节点
            <select name="node">${nodeViews.map((node) => `<option value="${escapeHtml(node.name)}">${escapeHtml(node.name)}</option>`).join("")}</select>
          </label>
          <label>名称 <input name="name" placeholder="codex-main" required pattern="[A-Za-z0-9_.:-]{1,80}" title="只能包含字母、数字、点、下划线、冒号或短横线"></label>
          <label class="grow">工作目录 <input name="cwd" value="${escapeHtml(process.cwd())}" required></label>
          <label>命令 <input name="command" value="bash" required></label>
          <button type="submit">创建</button>
        </div>
        <p id="create-status" class="muted form-status"></p>
      </form>
    </section>
    <section class="panel">
      <h2>当前会话</h2>
      <div class="table-wrap"><table>
        ${sessionTableHead}
        <tbody id="session-rows"></tbody>
      </table></div>
    </section>
    <section class="panel" id="hidden-panel" hidden>
      <details class="hidden-sessions">
        <summary><h2>已隐藏 (<span id="hidden-count">0</span>)</h2></summary>
        <div class="table-wrap" style="margin-top:14px"><table>
          ${sessionTableHead}
          <tbody id="hidden-rows"></tbody>
        </table></div>
      </details>
    </section>
    <script>
      const initial = ${jsonInline(nodeViews)};
${clientCommon()}
      let nodes = initial;
      let lastRenderKey = "";

      function rowHtml(nodeName, session) {
        const href = "/sessions/" + encodeURIComponent(nodeName) + "/" + encodeURIComponent(session.name);
        return "<tr>"
          + '<td><a class="mono" href="' + esc(href) + '">' + esc(nodeName + "/" + session.name) + "</a></td>"
          + "<td>" + pillHtml(session.status) + "</td>"
          + '<td data-activity-cmd="' + esc(session.command || "") + '" data-activity-at="' + esc(session.activityAt || "") + '">' + activityPillHtml(session.command, session.activityAt) + "</td>"
          + '<td class="path mono opt-col" title="' + esc(session.cwd || "") + '">' + esc(session.cwd || "-") + "</td>"
          + '<td data-ts="' + esc(session.lastUpdated || "") + '">' + esc(relTime(session.lastUpdated)) + "</td>"
          + "<td>" + (session.autoRecover ? '<span class="pill ok">已开启</span>' : '<span class="muted">-</span>') + "</td>"
          + '<td><span class="actions">'
            + '<a class="btn-sm button-link" href="' + esc(href) + '">打开</a>'
            + '<button class="btn-sm ghost toggle-vis" type="button" data-node="' + esc(nodeName) + '" data-session="' + esc(session.name) + '" data-hidden="' + (session.hidden ? "1" : "0") + '" title="' + (session.hidden ? "恢复显示此会话" : "隐藏此会话") + '">' + (session.hidden ? "显示" : "隐藏") + "</button>"
          + "</span></td>"
          + "</tr>";
      }

      function chipHtml(node) {
        const title = esc((node.url || "") + " · " + (STATUS_TEXT[node.status] || node.status || ""));
        return '<span class="chip ' + (node.status === "connected" ? "ok" : "bad") + '" title="' + title + '">'
          + "<strong>" + esc(node.name) + "</strong>"
          + "<span>" + (node.sessions || []).length + "</span>"
          + "</span>";
      }

      function renderAll() {
        const rows = [];
        const hiddenRows = [];
        for (const node of nodes) {
          for (const session of node.sessions || []) {
            (session.hidden ? hiddenRows : rows).push(rowHtml(node.name, session));
          }
        }
        document.querySelector("#summary").textContent = "已配置 " + nodes.length + " 个节点，" + rows.length + " 个可见会话" + (hiddenRows.length ? "，" + hiddenRows.length + " 个已隐藏" : "") + "。";
        document.querySelector("#node-chips").innerHTML = nodes.length ? nodes.map(chipHtml).join("") : '<span class="muted">尚未配置节点</span>';
        document.querySelector("#session-rows").innerHTML = rows.length ? rows.join("") : '<tr class="empty-row"><td colspan="7" class="empty">没有可见会话，点击右上角「新建会话」开始。</td></tr>';
        document.querySelector("#hidden-panel").hidden = hiddenRows.length === 0;
        document.querySelector("#hidden-count").textContent = hiddenRows.length;
        document.querySelector("#hidden-rows").innerHTML = hiddenRows.join("");
        lastRenderKey = JSON.stringify(nodes);
      }

      function scheduleRender() {
        if (actionsInFlight > 0) return;
        if (JSON.stringify(nodes) !== lastRenderKey) renderAll();
        updateTimes();
      }

      renderAll();
      const pollNow = startPolling((next) => { nodes = next; scheduleRender(); });

      const createPanel = document.querySelector("#create-panel");
      const toggleCreateButton = document.querySelector("#toggle-create");
      function setCreateOpen(open) {
        createPanel.hidden = !open;
        toggleCreateButton.textContent = open ? "收起" : "新建会话";
        if (open) createPanel.querySelector("input[name=name]").focus();
      }
      toggleCreateButton.addEventListener("click", () => setCreateOpen(createPanel.hidden));
      if (!initial.some((node) => (node.sessions || []).some((session) => !session.hidden))) setCreateOpen(true);

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
        const createdName = body.session && body.session.name ? body.session.name : data.name;
        location.href = "/sessions/" + encodeURIComponent(data.node) + "/" + encodeURIComponent(createdName);
      });

      document.addEventListener("click", async (event) => {
        const button = event.target.closest(".toggle-vis");
        if (!button || button.disabled) return;
        const nodeName = button.dataset.node;
        const sessionName = button.dataset.session;
        const hidden = button.dataset.hidden === "1";
        gen += 1;
        actionsInFlight += 1;
        button.disabled = true;
        button.textContent = "...";
        try {
          const response = await fetch("/api/sessions/" + encodeURIComponent(nodeName) + "/" + encodeURIComponent(sessionName) + "/hide", {
            method: "PUT",
            headers: {"content-type": "application/json"},
            body: JSON.stringify({hidden: !hidden})
          });
          if (response.ok) {
            for (const node of nodes) {
              if (node.name !== nodeName) continue;
              for (const session of node.sessions || []) {
                if (session.name === sessionName) session.hidden = !hidden;
              }
            }
          }
        } catch (_) {}
        actionsInFlight -= 1;
        renderAll();
        updateTimes();
        pollNow();
      });
    </script>
  `, "sessions");
}

export function renderNodesPage(nodeViews) {
  return page("节点", `
    <section class="hero">
      <div>
        <h1>节点</h1>
        <p>添加 Hub 可以访问到的机器，可以走 LAN、Tailscale、WireGuard 或 SSH 隧道。</p>
      </div>
      <div class="hero-actions">
        <span class="live-indicator"><span id="live-dot" class="live-dot"></span><span id="live-text" class="muted">自动刷新中</span></span>
        <button id="toggle-add" type="button">添加节点</button>
      </div>
    </section>
    <section class="panel" id="add-panel" hidden>
      <h2>添加节点</h2>
      <form id="add-node">
        <div class="form-row">
          <label>名称 <input name="name" placeholder="devbox" required pattern="[A-Za-z0-9_.:-]{1,80}"></label>
          <label class="grow">地址 <input name="url" placeholder="http://100.x.x.x:8091" required></label>
          <label>模式 <input name="mode" value="remote"></label>
          <button type="submit">添加节点</button>
        </div>
        <p id="node-status" class="muted form-status"></p>
      </form>
    </section>
    <section class="panel">
      <h2>已配置节点</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>名称</th><th>状态</th><th class="opt-col">地址</th><th>会话数</th><th></th></tr></thead>
        <tbody id="node-rows"></tbody>
      </table></div>
    </section>
    <script>
      const initial = ${jsonInline(nodeViews)};
${clientCommon()}
      let nodes = initial;
      let lastRenderKey = "";

      function nodeRowHtml(node) {
        const canRemove = node.name !== "local" && node.mode !== "connected";
        return "<tr>"
          + '<td class="mono">' + esc(node.name) + "</td>"
          + "<td>" + pillHtml(node.status) + "</td>"
          + '<td class="path mono opt-col" title="' + esc(node.url || "") + '">' + esc(node.url || "-") + "</td>"
          + "<td>" + (node.sessions || []).length + "</td>"
          + "<td>" + (canRemove ? '<button class="btn-sm ghost danger-text remove-node" type="button" data-name="' + esc(node.name) + '">移除</button>' : "") + "</td>"
          + "</tr>";
      }

      function renderAll() {
        document.querySelector("#node-rows").innerHTML = nodes.length
          ? nodes.map(nodeRowHtml).join("")
          : '<tr class="empty-row"><td colspan="5" class="empty">尚未添加节点，点击右上角「添加节点」。</td></tr>';
        lastRenderKey = JSON.stringify(nodes);
      }

      function scheduleRender() {
        if (actionsInFlight > 0) return;
        if (JSON.stringify(nodes) !== lastRenderKey) renderAll();
        updateTimes();
      }

      renderAll();
      const pollNow = startPolling((next) => { nodes = next; scheduleRender(); });

      const addPanel = document.querySelector("#add-panel");
      const toggleAddButton = document.querySelector("#toggle-add");
      function setAddOpen(open) {
        addPanel.hidden = !open;
        toggleAddButton.textContent = open ? "收起" : "添加节点";
        if (open) addPanel.querySelector("input[name=name]").focus();
      }
      toggleAddButton.addEventListener("click", () => setAddOpen(addPanel.hidden));

      document.querySelector("#add-node").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const status = document.querySelector("#node-status");
        const data = Object.fromEntries(new FormData(form).entries());
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
        status.textContent = "已添加";
        form.elements.name.value = "";
        form.elements.url.value = "";
        gen += 1;
        pollNow();
      });

      document.addEventListener("click", async (event) => {
        const button = event.target.closest(".remove-node");
        if (!button || button.disabled) return;
        const name = button.dataset.name;
        if (!confirm("移除节点 " + name + "？")) return;
        gen += 1;
        actionsInFlight += 1;
        button.disabled = true;
        button.textContent = "...";
        try {
          await fetch("/api/nodes/" + encodeURIComponent(name), {method: "DELETE"});
          nodes = nodes.filter((node) => node.name !== name);
        } catch (_) {}
        actionsInFlight -= 1;
        renderAll();
        updateTimes();
        pollNow();
      });
    </script>
  `, "nodes");
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
  const visibleLines = text.split("\n").filter((line) => !isHiddenOutputLine(line.trim()));
  while (visibleLines.length && !visibleLines[0].trim()) visibleLines.shift();
  while (visibleLines.length && !visibleLines[visibleLines.length - 1].trim()) visibleLines.pop();
  if (!visibleLines.length) return [];
  return [{ role: "agent", text: visibleLines.join("\n") }];
}

function isHiddenOutputLine(line) {
  if (!line) return false;
  return [
    /^(?=.{3,}$)[\s\-_=.*·•─━╌╍┄┅]+$/,
    /^(model|working directory|workdir|cwd|approval policy|sandbox|network access|shell|timezone)\s*[:=]/i,
    /^system:\s*you are (codex|chatgpt|an ai|a coding agent)/i,
    /^you are (codex|chatgpt|an ai|a coding agent)/i,
    /^<[/]?(instructions|environment_context|workspace_roots|filesystem)>$/i,
    /^(agent instructions|environment_context|filesystem sandboxing|sandbox_mode|approval_policy)\b/i,
    /^current date\s*[:=]/i
  ].some((pattern) => pattern.test(line));
}

export function chatMessagesFromOutput(output) {
  return splitChatBlocks(output).map((block) => {
    return { role: block.role, label: "Output", text: block.text };
  });
}

export function renderChatMessages(output) {
  const blocks = chatMessagesFromOutput(output);
  if (!blocks.length) return `<div class="empty chat-empty">暂无输出</div>`;
  return blocks.map(({ role, label, text }) => {
    return `<article class="chat-message ${role}">
      <div class="chat-role">${label}</div>
      <pre>${escapeHtml(text)}</pre>
    </article>`;
  }).join("");
}

export function renderTranscriptMessages(messages = [], fallbackOutput = "") {
  const normalized = Array.isArray(messages)
    ? messages.map((message) => normalizeTranscriptMessage(message)).filter(Boolean)
    : [];
  const blocks = normalized.length ? normalized : chatMessagesFromOutput(fallbackOutput);
  if (!blocks.length) return `<div class="empty chat-empty">暂无输出</div>`;
  return blocks.map(({ role, label, text }) => {
    return `<article class="chat-message ${role}">
      <div class="chat-role">${escapeHtml(label)}</div>
      <pre>${escapeHtml(text)}</pre>
    </article>`;
  }).join("");
}

function normalizeTranscriptMessage(message) {
  if (!message || typeof message !== "object") return null;
  const text = String(message.text || "").trim();
  if (!text) return null;
  const role = ["user", "agent", "session"].includes(message.role) ? message.role : "agent";
  const label = role === "user" ? "Input" : role === "session" ? "Session" : "Output";
  return { role, label, text };
}

export function renderSessionPage({ node, name, windows = [], selectedWindow = "", output, transcript = null, autoRecoverConfig = null }) {
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
    <section class="session-bar">
      <a class="back" href="/sessions">← 会话列表</a>
      <h1>${escapeHtml(node.name)}/${escapeHtml(name)}</h1>
      <span class="meta">${escapeHtml(node.url)} · Chat log</span>
      <button id="stop-session" class="danger">停止</button>
    </section>
    <section class="panel terminal-panel">
      <div class="window-tabs">
        ${windows.length ? windows.map((windowItem) => renderWindowTab(node, name, windowItem, activeWindow)).join("") : `<span class="muted">没有找到窗口</span>`}
      </div>
      <div class="terminal-tools">
        <span class="terminal-status"><span id="activity-pill" class="pill" hidden></span><span id="autorecover-status">${escapeHtml(autoRecoverStatus)}</span></span>
        <span class="terminal-actions">
          <button id="toggle-autorecover" class="ghost" type="button">${escapeHtml(autoRecoverLabel)}</button>
          <button id="toggle-smartrecover" class="ghost" type="button">${escapeHtml(smartRecoverLabel)}</button>
        </span>
      </div>
      <div id="chat-log" class="chat-log" tabindex="0">${renderTranscriptMessages(transcript?.messages || [], output)}</div>
      <details class="raw-output">
        <summary>查看原始输出</summary>
        <pre id="raw-output-text">${escapeHtml(output || "")}</pre>
      </details>
      <form id="send-message" class="chat-input">
        <input name="text" autocomplete="off" autofocus placeholder="输入一行内容后按回车">
        <button type="submit">发送</button>
      </form>
      <p id="send-status" class="muted"></p>
    </section>
    <script>
      const node = ${scriptJson(node.name)};
      const name = ${scriptJson(name)};
      const activeWindow = ${scriptJson(activeWindow)};
      let autoRecoverOnActiveWindow = ${JSON.stringify(autoRecoverOnActiveWindow)};
      let smartRecoverEnabled = ${JSON.stringify(smartRecoverEnabled)};
      const chatLog = document.querySelector("#chat-log");
      const initialTranscriptMessages = ${scriptJson(transcript?.messages || [])};
      const sendForm = document.querySelector("#send-message");
      const sendInput = sendForm.elements.text;
      const sendButton = sendForm.querySelector("button[type='submit']");
      const sendStatus = document.querySelector("#send-status");
      let agentWorking = ${JSON.stringify(!!transcript?.working)};
      let sending = false;
      let autoscroll = true;
${clientActivityCore()}
      function updateActivityPill(command, activityAt) {
        const pill = document.querySelector("#activity-pill");
        if (!pill) return;
        const state = activityState(command, activityAt);
        if (!state) { pill.hidden = true; return; }
        pill.hidden = false;
        if (state === "idle") {
          pill.className = "pill";
          pill.textContent = "空闲";
          pill.title = "前台没有正在运行的命令";
        } else if (state === "stalled") {
          pill.className = "pill bad";
          pill.textContent = command + " · 卡住?";
          pill.title = "超过 " + Math.round(STALL_MS / 1000) + " 秒没有新输出，可能卡住或在等待输入";
        } else {
          pill.className = "pill ok run";
          pill.textContent = command;
          pill.title = "正在运行";
        }
      }

      function updateSendControls() {
        sendInput.disabled = sending;
        sendButton.disabled = sending || agentWorking;
        if (!sending && agentWorking) {
          sendStatus.textContent = "Agent 正在工作，结束后再发送";
        } else if (!sending && sendStatus.textContent === "Agent 正在工作，结束后再发送") {
          sendStatus.textContent = "";
        }
      }

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
        const visibleLines = text.split("\\n").filter((line) => !isHiddenOutputLine(line.trim()));
        while (visibleLines.length && !visibleLines[0].trim()) visibleLines.shift();
        while (visibleLines.length && !visibleLines[visibleLines.length - 1].trim()) visibleLines.pop();
        if (!visibleLines.length) return [];
        return [{role: "agent", text: visibleLines.join("\\n")}];
      }

      function isHiddenOutputLine(line) {
        if (!line) return false;
        return [
          /^(?=.{3,}$)[\\s\\-_=.*·•─━╌╍┄┅]+$/,
          /^(model|working directory|workdir|cwd|approval policy|sandbox|network access|shell|timezone)\\s*[:=]/i,
          /^system:\\s*you are (codex|chatgpt|an ai|a coding agent)/i,
          /^you are (codex|chatgpt|an ai|a coding agent)/i,
          /^<[/]?(instructions|environment_context|workspace_roots|filesystem)>$/i,
          /^(agent instructions|environment_context|filesystem sandboxing|sandbox_mode|approval_policy)\\b/i,
          /^current date\\s*[:=]/i
        ].some((pattern) => pattern.test(line));
      }

      function renderChat(output) {
        return renderMessages([], output);
      }

      function normalizeTranscriptMessage(message) {
        if (!message || typeof message !== "object") return null;
        const text = String(message.text || "").trim();
        if (!text) return null;
        const role = ["user", "agent", "session"].includes(message.role) ? message.role : "agent";
        const label = role === "user" ? "Input" : role === "session" ? "Session" : "Output";
        return {role, label, text};
      }

      function renderMessages(messages, output) {
        const normalized = Array.isArray(messages) ? messages.map(normalizeTranscriptMessage).filter(Boolean) : [];
        const blocks = normalized.length ? normalized : splitChatBlocks(output);
        if (!blocks.length) {
          return '<div class="empty chat-empty">暂无输出</div>';
        }
        return blocks.map((block) => {
          return '<article class="chat-message ' + block.role + '"><div class="chat-role">' + escapeText(block.label || "Output") + '</div><pre>' + escapeText(block.text) + '</pre></article>';
        }).join("");
      }

      async function refreshOutput() {
        try {
        const outputQuery = new URLSearchParams({lines: "2000"});
        const transcriptQuery = new URLSearchParams({lines: "500"});
        if (activeWindow !== "") {
          outputQuery.set("window", activeWindow);
          transcriptQuery.set("window", activeWindow);
        }
        const [outputResponse, transcriptResponse] = await Promise.all([
          fetch("/api/sessions/" + encodeURIComponent(node) + "/" + encodeURIComponent(name) + "/output?" + outputQuery.toString()),
          fetch("/api/sessions/" + encodeURIComponent(node) + "/" + encodeURIComponent(name) + "/transcript-state?" + transcriptQuery.toString())
        ]);
        if (!outputResponse.ok) return;
        const body = await outputResponse.json();
        const transcriptBody = transcriptResponse.ok ? await transcriptResponse.json().catch(() => ({})) : {};
        updateActivityPill(body.command, body.activityAt);
        if (body.inMode) return;
        agentWorking = !!transcriptBody.working;
        updateSendControls();
        const previousScrollTop = chatLog.scrollTop;
        chatLog.innerHTML = renderMessages(transcriptBody.messages || [], body.output || "");
        const rawOutput = document.querySelector("#raw-output-text");
        if (rawOutput) rawOutput.textContent = body.output || "";
        if (autoscroll) {
          chatLog.scrollTop = chatLog.scrollHeight;
        } else {
          chatLog.scrollTop = previousScrollTop;
        }
        } catch(e) { chatLog.innerHTML = '<div class="error">[refresh error] ' + escapeText(e.message || String(e)) + '</div>'; }
      }

      sendForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (agentWorking) {
          sendStatus.textContent = "Agent 正在工作，结束后再发送";
          updateSendControls();
          return;
        }
        const text = sendInput.value;
        if (!text.trim()) return;
        sendInput.value = "";
        sending = true;
        updateSendControls();
        sendStatus.textContent = "正在发送...";
        try {
          const response = await fetch("/api/sessions/" + encodeURIComponent(node) + "/" + encodeURIComponent(name) + "/send", {
            method: "POST",
            headers: {"content-type": "application/json"},
            body: JSON.stringify({text, window: activeWindow})
          });
          const body = await response.json().catch(() => ({}));
          sendStatus.textContent = response.ok ? "已发送，等待输出..." : (body.detail || "发送失败");
          setTimeout(refreshOutput, 120);
        } catch (error) {
          sendStatus.textContent = "发送失败：" + (error.message || String(error));
        } finally {
          sending = false;
          updateSendControls();
          sendInput.focus();
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
      if (initialTranscriptMessages.length) {
        chatLog.innerHTML = renderMessages(initialTranscriptMessages, "");
      }
      updateSendControls();
      chatLog.scrollTop = chatLog.scrollHeight;
    </script>
  `, "sessions");
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

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function jsonInline(value) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function clientActivityCore() {
  return `
      const SHELLS = ["sh", "bash", "zsh", "fish", "dash", "ash", "ksh", "csh", "tcsh", "pwsh", "nu", "login"];
      const STALL_MS = 60000;
      function activityState(command, activityAt) {
        if (!command) return null;
        if (SHELLS.indexOf(String(command)) >= 0) return "idle";
        const last = activityAt ? new Date(activityAt).getTime() : 0;
        if (last && Date.now() - last > STALL_MS) return "stalled";
        return "running";
      }
`;
}

function clientCommon() {
  return clientActivityCore() + `
      function esc(value) {
        return String(value ?? "")
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;");
      }
      function relTime(value) {
        if (!value) return "-";
        const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
        if (seconds < 60) return seconds + "s ago";
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return minutes + "m ago";
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return hours + "h ago";
        return Math.floor(hours / 24) + "d ago";
      }
      const STATUS_TEXT = {connected: "已连接", disconnected: "未连接", attached: "已附加", detached: "后台运行", created: "已创建", stopped: "已停止"};
      const STATUS_KIND = {connected: "ok", attached: "ok", detached: "info", created: "info", disconnected: "bad", stopped: ""};
      function pillHtml(status) {
        const kind = STATUS_KIND[status] || "";
        const text = STATUS_TEXT[status] || status || "-";
        return '<span class="pill' + (kind ? " " + kind : "") + '">' + esc(text) + "</span>";
      }
      function activityPillHtml(command, activityAt) {
        const state = activityState(command, activityAt);
        if (!state) return '<span class="muted">-</span>';
        if (state === "idle") return '<span class="pill" title="前台没有正在运行的命令">空闲</span>';
        if (state === "stalled") return '<span class="pill bad" title="超过 ' + Math.round(STALL_MS / 1000) + ' 秒没有新输出，可能卡住或在等待输入">' + esc(command) + ' · 卡住?</span>';
        return '<span class="pill ok run" title="正在运行">' + esc(command) + "</span>";
      }
      function updateTimes() {
        for (const cell of document.querySelectorAll("[data-ts]")) {
          cell.textContent = relTime(cell.dataset.ts);
        }
        for (const cell of document.querySelectorAll("[data-activity-cmd]")) {
          cell.innerHTML = activityPillHtml(cell.dataset.activityCmd, cell.dataset.activityAt || "");
        }
      }
      let gen = 0;
      let actionsInFlight = 0;
      function startPolling(onData) {
        let inFlight = false;
        let failures = 0;
        let timer = null;
        const dot = document.querySelector("#live-dot");
        const liveText = document.querySelector("#live-text");
        function setLive(ok) {
          if (dot) dot.classList.toggle("bad", !ok);
          if (liveText) liveText.textContent = ok ? "自动刷新中" : "连接失败，正在重试...";
        }
        function schedule(delay) {
          clearTimeout(timer);
          timer = setTimeout(poll, delay);
        }
        async function poll() {
          if (inFlight) return;
          if (document.hidden) { schedule(5000); return; }
          inFlight = true;
          const g = gen;
          try {
            const response = await fetch("/api/sessions");
            if (response.status === 401) { location.reload(); return; }
            if (!response.ok) throw new Error("HTTP " + response.status);
            const body = await response.json();
            failures = 0;
            setLive(true);
            if (g === gen) onData(body.nodes || []);
          } catch (_) {
            failures += 1;
            setLive(false);
          } finally {
            inFlight = false;
            schedule(Math.min(5000 * 2 ** failures, 60000));
          }
        }
        document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
        schedule(5000);
        return poll;
      }
`;
}

function scriptJson(value) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function styles() {
  return `
    :root {
      color-scheme: light dark;
      --bg: #f6f8fb; --panel: #fff; --panel-2: #fbfcfe;
      --text: #182230; --text-soft: #344054; --muted: #667085; --muted-strong: #475467;
      --line: #d9e0ea; --line-soft: #edf1f6;
      --accent: #1769e0; --accent-bg: #1769e0; --accent-bg-hover: #1257c2; --accent-soft: #e8f0fd; --on-accent: #fff;
      --ok: #067647; --ok-bg: #dcfae6; --bad: #b42318; --bad-bg: #fee4e2;
      --info: #175cd3; --info-bg: #e3edfd; --pill-bg: #eef2f7; --danger-bg: #b42318;
      --input-bg: #fff; --input-border: #cbd5e1; --row-hover: #f7f9fc;
      --focus-ring: rgba(23, 105, 224, 0.18); --shadow: 0 1px 2px rgba(16, 24, 40, 0.05);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0b101c; --panel: #121826; --panel-2: #161e2e;
        --text: #e7ecf5; --text-soft: #ccd4e0; --muted: #8e99ad; --muted-strong: #a8b1c2;
        --line: #283349; --line-soft: #1e2738;
        --accent: #7ea6f4; --accent-bg: #2767d9; --accent-bg-hover: #3b78e8; --accent-soft: #1a2740; --on-accent: #fff;
        --ok: #54d18c; --ok-bg: #122b1e; --bad: #f97066; --bad-bg: #341a1c;
        --info: #8db1f5; --info-bg: #16233c; --pill-bg: #1d2636; --danger-bg: #cf3b30;
        --input-bg: #0f1522; --input-border: #2c3850; --row-hover: #18202f;
        --focus-ring: rgba(126, 166, 244, 0.25); --shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
      }
    }
    * { box-sizing: border-box; }
    body { margin: 0; font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--text); background: var(--bg); }
    header { height: 56px; display: flex; align-items: center; gap: 22px; padding: 0 24px; background: var(--panel); border-bottom: 1px solid var(--line); position: sticky; top: 0; z-index: 1; }
    .brand { font-weight: 700; color: var(--text); text-decoration: none; white-space: nowrap; }
    nav { display: flex; gap: 6px; flex: 1; }
    a { color: var(--accent); text-decoration: none; }
    nav a { color: var(--muted); font-weight: 500; padding: 6px 10px; border-radius: 6px; }
    nav a:hover { color: var(--text); background: var(--row-hover); }
    nav a.is-active { color: var(--accent); font-weight: 600; background: var(--accent-soft); }
    main { max-width: 1180px; margin: 0 auto; padding: 24px; }
    main.session-main { max-width: 1600px; padding: 18px 24px 24px; }
    h1, h2 { margin: 0; line-height: 1.2; }
    h1 { font-size: 26px; letter-spacing: -0.01em; }
    h2 { font-size: 16px; margin-bottom: 14px; }
    p { margin: 8px 0 0; color: var(--muted); }
    .hero { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 18px; }
    .hero-actions { display: flex; align-items: center; gap: 14px; }
    .live-indicator { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; }
    .live-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); flex: none; }
    @media (prefers-reduced-motion: no-preference) {
      .live-dot { animation: live-pulse 2.4s ease-in-out infinite; }
      .pill.run::before { animation: live-pulse 1.6s ease-in-out infinite; }
      @keyframes live-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
    }
    .live-dot.bad { background: var(--bad); animation: none; }
    .node-strip { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
    .node-strip > a { font-size: 13px; white-space: nowrap; }
    .node-chips { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .chip { display: inline-flex; align-items: center; gap: 7px; border: 1px solid var(--line); background: var(--panel); border-radius: 999px; padding: 5px 12px; font-size: 13px; box-shadow: var(--shadow); }
    .chip::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--muted); flex: none; }
    .chip.ok::before { background: var(--ok); }
    .chip.bad::before { background: var(--bad); }
    .chip span { color: var(--muted); font-size: 12px; }
    .form-row { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; }
    .form-row label { flex: 1 1 150px; min-width: 150px; }
    .form-row label.grow { flex-grow: 1.8; }
    .form-row button { flex: 0 0 auto; }
    .form-status { margin: 8px 0 0; }
    .form-status:empty { display: none; }
    .session-bar { display: flex; align-items: center; gap: 14px; min-width: 0; margin-bottom: 14px; }
    .session-bar .back { color: var(--muted); white-space: nowrap; font-size: 13px; }
    .session-bar .back:hover { color: var(--text); }
    .session-bar h1 { font: 600 16px/1.3 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .session-bar .meta { flex: 1; min-width: 0; color: var(--muted); font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .actions { display: inline-flex; align-items: center; gap: 8px; }
    .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 18px; box-shadow: var(--shadow); }
    main > .panel { margin-bottom: 18px; }
    .panel.narrow { max-width: 400px; margin: 80px auto; }
    .login-brand { text-align: center; margin-bottom: 18px; }
    .login-brand h1 { font-size: 22px; }
    .login-brand p { margin-top: 4px; }
    .form-error { background: var(--bad-bg); color: var(--bad); border-radius: 8px; padding: 8px 12px; font-size: 13px; margin: 0; }
    .stack { display: grid; gap: 12px; }
    label { display: grid; gap: 6px; color: var(--text-soft); font-weight: 600; font-size: 13px; }
    input, select, button { font: inherit; }
    input, select { width: 100%; border: 1px solid var(--input-border); border-radius: 8px; padding: 9px 12px; background: var(--input-bg); color: var(--text); transition: border-color 0.15s, box-shadow 0.15s; }
    input:focus, select:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--focus-ring); outline: none; }
    :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    button, .button-link { border: 0; border-radius: 8px; padding: 8px 14px; min-height: 36px; background: var(--accent-bg); color: var(--on-accent); font-weight: 500; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; white-space: nowrap; transition: background 0.15s; }
    button:hover, .button-link:hover { background: var(--accent-bg-hover); }
    button.ghost { background: transparent; border: 1px solid var(--line); color: var(--text-soft); padding: 7px 12px; }
    button.ghost:hover { background: var(--row-hover); }
    button.danger { background: var(--danger-bg); }
    button.danger:hover { background: var(--danger-bg); filter: brightness(1.08); }
    button:disabled { opacity: 0.55; cursor: default; }
    .danger-text { color: var(--bad) !important; }
    button.ghost.danger-text:hover { background: var(--bad-bg); }
    .btn-sm { padding: 3px 10px; min-height: 28px; font-size: 12.5px; border-radius: 6px; font-weight: 500; }
    .muted, .empty { color: var(--muted); }
    .error, .bad-text { color: var(--bad); }
    .ok-text { color: var(--ok); }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12.5px; }
    .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
    table { width: 100%; border-collapse: collapse; min-width: 480px; }
    th, td { text-align: left; border-bottom: 1px solid var(--line-soft); padding: 10px 8px; vertical-align: middle; }
    tbody tr:last-child td { border-bottom: 0; }
    tbody tr:not(.empty-row):hover td { background: var(--row-hover); }
    th { color: var(--muted-strong); font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.02em; white-space: nowrap; }
    td.empty { text-align: center; padding: 28px 12px; }
    .path { max-width: 420px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted-strong); }
    .pill { display: inline-flex; align-items: center; gap: 5px; border-radius: 999px; background: var(--pill-bg); color: var(--text-soft); padding: 3px 9px; font-size: 12px; white-space: nowrap; }
    .pill::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex: none; }
    .pill.ok { background: var(--ok-bg); color: var(--ok); }
    .pill.bad { background: var(--bad-bg); color: var(--bad); }
    .pill.info { background: var(--info-bg); color: var(--info); }
    .hidden-sessions summary { cursor: pointer; }
    .hidden-sessions summary h2 { display: inline; margin: 0; }
    .terminal-panel { padding: 0; overflow: hidden; margin-bottom: 0; }
    .window-tabs { display: flex; gap: 8px; overflow-x: auto; -webkit-overflow-scrolling: touch; padding: 10px 12px; border-bottom: 1px solid var(--line); background: var(--panel); }
    .window-tab { min-width: 120px; border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; color: var(--text); display: grid; gap: 2px; text-decoration: none; }
    .window-tab:hover { background: var(--row-hover); }
    .window-tab span { color: var(--muted); font-size: 12px; }
    .window-tab.is-active { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
    .window-tab.is-active span { color: var(--accent); opacity: 0.75; }
    .terminal-tools { min-height: 48px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 12px; border-bottom: 1px solid var(--line); background: var(--panel-2); color: var(--muted); font-size: 13px; }
    .terminal-status { display: inline-flex; align-items: center; gap: 10px; min-width: 0; }
    .terminal-actions { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
    .chat-log { height: calc(100vh - 238px); min-height: 560px; overflow: auto; overscroll-behavior: contain; display: grid; align-content: start; gap: 12px; padding: 16px; background: var(--bg); }
    .chat-message { max-width: 980px; border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; background: var(--panel); }
    .chat-message.user { justify-self: end; background: var(--accent-soft); border-color: var(--accent); }
    .chat-message.error { border-color: var(--bad); background: var(--bad-bg); }
    .chat-message.system { background: var(--panel-2); }
    .chat-role { color: var(--muted); font-size: 12px; font-weight: 700; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0; }
    .chat-message pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; color: var(--text); font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    .chat-empty { padding: 20px; }
    .raw-output { border-top: 1px solid var(--line); background: var(--panel); }
    .raw-output summary { cursor: pointer; padding: 9px 12px; color: var(--muted); font-size: 12px; font-weight: 700; }
    .raw-output pre { max-height: 260px; overflow: auto; margin: 0; padding: 12px; border-top: 1px solid var(--line-soft); background: var(--panel-2); color: var(--text-soft); white-space: pre-wrap; overflow-wrap: anywhere; font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    .chat-input { display: grid; grid-template-columns: 1fr auto; gap: 10px; padding: 12px; border-top: 1px solid var(--line); background: var(--panel); }
    #send-status { margin: 0; padding: 6px 12px 10px; font-size: 12px; min-height: 30px; background: var(--panel); }

    @media (max-width: 760px) {
      main, main.session-main { padding: 14px; }
      header { height: auto; min-height: 50px; gap: 12px; padding: 10px 14px; flex-wrap: wrap; }
      nav { gap: 6px; }
      h1 { font-size: 22px; }
      .hero { display: grid; gap: 12px; }
      .session-bar { flex-wrap: wrap; }
      button, .button-link, .btn-sm { min-height: 44px; }
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
      .form-row label { min-width: 100%; }
      .form-row button { width: 100%; }
      .session-bar .meta { display: none; }
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
