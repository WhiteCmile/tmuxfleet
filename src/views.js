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
  const sessionTableHead = `<thead><tr><th>标识</th><th>状态</th><th class="opt-col">目录</th><th class="opt-col">命令</th><th>更新时间</th><th>自动恢复</th><th></th><th></th></tr></thead>`;
  return page("会话", `
    <section class="hero">
      <div>
        <h1>会话</h1>
        <p id="summary">正在加载...</p>
      </div>
      <span class="live-indicator"><span id="live-dot" class="live-dot"></span><span id="live-text" class="muted">自动刷新中</span></span>
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
        <div class="node-list" id="node-list"></div>
      </div>
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
          + '<td class="path mono opt-col" title="' + esc(session.cwd || "") + '">' + esc(session.cwd || "-") + "</td>"
          + '<td class="mono opt-col">' + esc(session.command || "-") + "</td>"
          + '<td data-ts="' + esc(session.lastUpdated || "") + '">' + esc(relTime(session.lastUpdated)) + "</td>"
          + "<td>" + (session.autoRecover ? '<span class="pill ok">已开启</span>' : '<span class="muted">-</span>') + "</td>"
          + '<td><a class="btn-sm button-link" href="' + esc(href) + '">打开</a></td>'
          + '<td><button class="btn-sm ghost toggle-vis" type="button" data-node="' + esc(nodeName) + '" data-session="' + esc(session.name) + '" data-hidden="' + (session.hidden ? "1" : "0") + '" title="' + (session.hidden ? "恢复显示此会话" : "隐藏此会话") + '">' + (session.hidden ? "显示" : "隐藏") + "</button></td>"
          + "</tr>";
      }

      function badgeHtml(node) {
        return '<div class="node-badge">'
          + "<strong>" + esc(node.name) + "</strong>"
          + pillHtml(node.status)
          + "<small>" + (node.sessions || []).length + " 个会话</small>"
          + "</div>";
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
        document.querySelector("#node-list").innerHTML = nodes.length ? nodes.map(badgeHtml).join("") : '<p class="muted">尚未配置节点。</p>';
        document.querySelector("#session-rows").innerHTML = rows.length ? rows.join("") : '<tr class="empty-row"><td colspan="8" class="empty">没有可见会话，可在上方创建。</td></tr>';
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
      <span class="live-indicator"><span id="live-dot" class="live-dot"></span><span id="live-text" class="muted">自动刷新中</span></span>
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
          <tbody id="node-rows"></tbody>
        </table></div>
      </div>
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
          : '<tr class="empty-row"><td colspan="5" class="empty">尚未添加节点。</td></tr>';
        lastRenderKey = JSON.stringify(nodes);
      }

      function scheduleRender() {
        if (actionsInFlight > 0) return;
        if (JSON.stringify(nodes) !== lastRenderKey) renderAll();
        updateTimes();
      }

      renderAll();
      const pollNow = startPolling((next) => { nodes = next; scheduleRender(); });

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

function palette256(n) {
  if (n < 16) { const c = ["#1c1c1c","#cc342d","#198844","#c4a000","#3971ed","#a36ac7","#3971ed","#c5c8c6","#545454","#f96a5d","#40d472","#f0c600","#6ea8fe","#d2a8ff","#79c0ff","#fff"]; return c[n] || "#e4e7ec"; }
  if (n < 232) { n -= 16; var r = Math.floor(n/36), g = Math.floor((n%36)/6), b = n%6; return "#"+[r?String(55+r*40).padStart(2,"0"):"00", g?String(55+g*40).padStart(2,"0"):"00", b?String(55+b*40).padStart(2,"0"):"00"].join(""); }
  var v = 8 + (n-232)*10; var h = v.toString(16).padStart(2,"0"); return "#"+h+h+h;
}

function ansiToHtml(text) {
  text = String(text).replace(/\x1b\[[0-9;?]*[A-Za-ln-z]/g, "").replace(/\x1b\][^\x07]*\x07/g, "");
  const sgr = {
    0: [], 1: ["b"], 2: ["dim"], 3: ["i"], 4: ["u"],
    30: ["c0"], 31: ["c1"], 32: ["c2"], 33: ["c3"],
    34: ["c4"], 35: ["c5"], 36: ["c6"], 37: ["c7"],
    40: ["bg0"], 41: ["bg1"], 42: ["bg2"], 43: ["bg3"],
    44: ["bg4"], 45: ["bg5"], 46: ["bg6"], 47: ["bg7"],
    90: ["c8"], 91: ["c9"], 92: ["c10"], 93: ["c11"],
    94: ["c12"], 95: ["c13"], 96: ["c14"], 97: ["c15"],
    100: ["bg8"], 101: ["bg9"], 102: ["bg10"], 103: ["bg11"],
    104: ["bg12"], 105: ["bg13"], 106: ["bg14"], 107: ["bg15"]
  };
  const parts = text.split(/\x1b\[([0-9;]*)m/);
  const spans = [];
  const classes = [];
  var styles = {}, styleStr = "";
  function buildStyle() {
    var p = [];
    if (styles.fg) p.push("color:"+styles.fg);
    if (styles.bg) p.push("background:"+styles.bg);
    styleStr = p.length ? p.join(";") : "";
  }
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      if (parts[i]) {
        var spanAttrs = "";
        if (classes.length) spanAttrs += ' class="' + classes.join(" ") + '"';
        if (styleStr) spanAttrs += ' style="' + styleStr + '"';
        spans.push(spanAttrs
          ? '<span' + spanAttrs + '>' + escapeHtml(parts[i]) + '</span>'
          : escapeHtml(parts[i]));
      }
    } else {
      const codes = parts[i] ? parts[i].split(";").map(Number) : [0];
      for (var j = 0; j < codes.length; j++) {
        var c = codes[j];
        if (c === 0) { classes.length = 0; styles = {}; styleStr = ""; continue; }
        if (c === 39) { delete styles.fg; for (var ci = classes.length-1; ci >= 0; ci--) { if (classes[ci][0] === "c") classes.splice(ci, 1); } buildStyle(); continue; }
        if (c === 49) { delete styles.bg; for (var ci = classes.length-1; ci >= 0; ci--) { if (classes[ci].startsWith("bg")) classes.splice(ci, 1); } buildStyle(); continue; }
        if (c === 38 && codes[j+1] === 5 && codes[j+2] != null) { styles.fg = palette256(codes[j+2]); j += 2; buildStyle(); continue; }
        if (c === 48 && codes[j+1] === 5 && codes[j+2] != null) { styles.bg = palette256(codes[j+2]); j += 2; buildStyle(); continue; }
        const add = sgr[c];
        if (add) {
          for (var k = 0; k < add.length; k++) {
            var idx = classes.indexOf(add[k]);
            if (idx >= 0) classes.splice(idx, 1);
            classes.push(add[k]);
          }
        }
      }
    }
  }
  return spans.join("");
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
        <p>${escapeHtml(node.url)} · HTTP 轮询终端</p>
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
      <pre id="terminal" tabindex="0">${ansiToHtml(output)}</pre>
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
      let autoRecoverOnActiveWindow = ${JSON.stringify(autoRecoverOnActiveWindow)};
      let smartRecoverEnabled = ${JSON.stringify(smartRecoverEnabled)};
      const terminal = document.querySelector("#terminal");
      let autoscroll = true;
      let lastTerminalSize = "";
      let resizeTimer = null;

      terminal.addEventListener("scroll", () => {
        autoscroll = terminal.scrollTop + terminal.clientHeight >= terminal.scrollHeight - 20;
      });
      terminal.addEventListener("wheel", (event) => {
        if (terminal.scrollHeight <= terminal.clientHeight) return;
        event.preventDefault();
        terminal.scrollTop += event.deltaY;
        autoscroll = terminal.scrollTop + terminal.clientHeight >= terminal.scrollHeight - 20;
      }, { passive: false });
      terminal.addEventListener("keydown", (event) => {
        const keyScroll = {
          PageUp: -terminal.clientHeight * 0.9,
          PageDown: terminal.clientHeight * 0.9,
          ArrowUp: -24,
          ArrowDown: 24,
        }[event.key];
        if (keyScroll !== undefined) {
          event.preventDefault();
          terminal.scrollTop += keyScroll;
        } else if (event.key === "Home") {
          event.preventDefault();
          terminal.scrollTop = 0;
        } else if (event.key === "End") {
          event.preventDefault();
          terminal.scrollTop = terminal.scrollHeight;
        } else {
          return;
        }
        autoscroll = terminal.scrollTop + terminal.clientHeight >= terminal.scrollHeight - 20;
      });

      function measureTerminalSize() {
        const style = getComputedStyle(terminal);
        const probe = document.createElement("span");
        probe.textContent = "MMMMMMMMMM";
        probe.style.position = "absolute";
        probe.style.visibility = "hidden";
        probe.style.whiteSpace = "pre";
        probe.style.font = style.font;
        terminal.appendChild(probe);
        const rect = probe.getBoundingClientRect();
        probe.remove();
        const charWidth = rect.width / 10 || 8;
        const lineHeight = parseFloat(style.lineHeight) || rect.height || 18;
        const contentWidth = terminal.clientWidth - parseFloat(style.paddingLeft || 0) - parseFloat(style.paddingRight || 0);
        const contentHeight = terminal.clientHeight - parseFloat(style.paddingTop || 0) - parseFloat(style.paddingBottom || 0);
        return {
          cols: Math.max(40, Math.min(300, Math.floor(contentWidth / charWidth))),
          rows: Math.max(10, Math.min(120, Math.floor(contentHeight / lineHeight))),
        };
      }

      async function syncTerminalSize() {
        try {
          const size = measureTerminalSize();
          const key = size.cols + "x" + size.rows;
          if (key === lastTerminalSize) return;
          const response = await fetch("/api/sessions/" + encodeURIComponent(node) + "/" + encodeURIComponent(name) + "/resize", {
            method: "POST",
            headers: {"content-type": "application/json"},
            body: JSON.stringify({window: activeWindow, cols: size.cols, rows: size.rows})
          });
          if (response.ok) lastTerminalSize = key;
        } catch (_) {}
      }

      function scheduleTerminalResize() {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(syncTerminalSize, 120);
      }

      async function refreshOutput() {
        try {
        await syncTerminalSize();
        const query = new URLSearchParams({lines: "500"});
        if (activeWindow !== "") query.set("window", activeWindow);
        const response = await fetch("/api/sessions/" + encodeURIComponent(node) + "/" + encodeURIComponent(name) + "/output?" + query.toString());
        if (!response.ok) return;
        const body = await response.json();
        if (body.inMode) return;
        function p256(n) {
          if (n < 16) { var c=["#1c1c1c","#cc342d","#198844","#c4a000","#3971ed","#a36ac7","#3971ed","#c5c8c6","#545454","#f96a5d","#40d472","#f0c600","#6ea8fe","#d2a8ff","#79c0ff","#fff"]; return c[n]||"#e4e7ec"; }
          if (n < 232) { n-=16; var r=Math.floor(n/36),g=Math.floor((n%36)/6),b=n%6; return "#"+[r?String(55+r*40).padStart(2,"0"):"00",g?String(55+g*40).padStart(2,"0"):"00",b?String(55+b*40).padStart(2,"0"):"00"].join(""); }
          var v=8+(n-232)*10,h=v.toString(16).padStart(2,"0"); return "#"+h+h+h;
        }
        var ESC=String.fromCharCode(27),BEL=String.fromCharCode(7);
        var SGR={0:[],1:["b"],2:["dim"],3:["i"],4:["u"],30:["c0"],31:["c1"],32:["c2"],33:["c3"],34:["c4"],35:["c5"],36:["c6"],37:["c7"],40:["bg0"],41:["bg1"],42:["bg2"],43:["bg3"],44:["bg4"],45:["bg5"],46:["bg6"],47:["bg7"],90:["c8"],91:["c9"],92:["c10"],93:["c11"],94:["c12"],95:["c13"],96:["c14"],97:["c15"],100:["bg8"],101:["bg9"],102:["bg10"],103:["bg11"],104:["bg12"],105:["bg13"],106:["bg14"],107:["bg15"]};
        var t=(body.output||"").replace(new RegExp(ESC+"\\\\[[0-9;?]*[A-Za-ln-z]","g"),"").replace(new RegExp(ESC+"\\\\][^"+BEL+"]*"+BEL,"g"),"");
        var parts=t.split(new RegExp(ESC+"\\\\[([0-9;]*)m")),out=[],cs=[],ss={},sst="";
        for (var i=0;i<parts.length;i++) {
          if (i%2===0) {
            if (parts[i]) {
              var esc=parts[i].replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
              var attrs="";
              if (cs.length) attrs+=' class="'+cs.join(" ")+'"';
              if (sst) attrs+=' style="'+sst+'"';
              out.push(attrs ? '<span'+attrs+'>'+esc+'</span>' : esc);
            }
          } else {
            var codes=parts[i]?parts[i].split(";").map(Number):[0];
            for (var j=0;j<codes.length;j++) {
              var cd=codes[j];
              if (cd===0){cs.length=0;ss={};sst="";continue}
              if (cd===39){delete ss.fg;cs=cs.filter(function(x){return x[0]!=="c"});sst=(ss.fg?"color:"+ss.fg+";":"")+(ss.bg?"background:"+ss.bg:"");continue}
              if (cd===49){delete ss.bg;cs=cs.filter(function(x){return x[0]!=="b"||x[1]!=="g"});sst=(ss.fg?"color:"+ss.fg+";":"")+(ss.bg?"background:"+ss.bg:"");continue}
              if (cd===38&&codes[j+1]===5&&codes[j+2]!=null){ss.fg=p256(codes[j+2]);j+=2;sst=(ss.fg?"color:"+ss.fg+";":"")+(ss.bg?"background:"+ss.bg:"");continue}
              if (cd===48&&codes[j+1]===5&&codes[j+2]!=null){ss.bg=p256(codes[j+2]);j+=2;sst=(ss.fg?"color:"+ss.fg+";":"")+(ss.bg?"background:"+ss.bg:"");continue}
              var add=SGR[cd];
              if(add){for(var k=0;k<add.length;k++){var idx=cs.indexOf(add[k]);if(idx>=0)cs.splice(idx,1);cs.push(add[k])}}
            }
          }
        }
        const previousScrollTop = terminal.scrollTop;
        terminal.innerHTML = out.join("");
        if (autoscroll) {
          terminal.scrollTop = terminal.scrollHeight;
        } else {
          terminal.scrollTop = previousScrollTop;
        }
        } catch(e) { terminal.textContent = "[refresh error] " + (e.message || String(e)); }
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
      if (window.ResizeObserver) {
        new ResizeObserver(scheduleTerminalResize).observe(terminal);
      }
      window.addEventListener("resize", scheduleTerminalResize);
      syncTerminalSize().then(refreshOutput);
      setInterval(refreshOutput, 1000);
      terminal.scrollTop = terminal.scrollHeight;
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

function clientCommon() {
  return `
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
      function updateTimes() {
        for (const cell of document.querySelectorAll("[data-ts]")) {
          cell.textContent = relTime(cell.dataset.ts);
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
    .hero { display: flex; justify-content: space-between; align-items: end; gap: 16px; margin-bottom: 20px; }
    .hero.compact { align-items: center; }
    .live-indicator { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; padding-bottom: 4px; }
    .live-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); flex: none; }
    @media (prefers-reduced-motion: no-preference) {
      .live-dot { animation: live-pulse 2.4s ease-in-out infinite; }
      @keyframes live-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
    }
    .live-dot.bad { background: var(--bad); animation: none; }
    .grid.two { display: grid; grid-template-columns: minmax(280px, 0.8fr) 1.2fr; gap: 18px; margin-bottom: 18px; }
    .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 18px; box-shadow: var(--shadow); }
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
    .node-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; }
    .node-badge { border: 1px solid var(--line); border-radius: 10px; padding: 12px; display: grid; gap: 6px; justify-items: start; }
    .node-badge small { color: var(--muted); }
    .hidden-sessions summary { cursor: pointer; }
    .hidden-sessions summary h2 { display: inline; margin: 0; }
    .terminal-panel { padding: 0; overflow: hidden; }
    .window-tabs { display: flex; gap: 8px; overflow-x: auto; -webkit-overflow-scrolling: touch; padding: 10px 12px; border-bottom: 1px solid var(--line); background: var(--panel); }
    .window-tab { min-width: 120px; border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; color: var(--text); display: grid; gap: 2px; text-decoration: none; }
    .window-tab:hover { background: var(--row-hover); }
    .window-tab span { color: var(--muted); font-size: 12px; }
    .window-tab.is-active { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
    .window-tab.is-active span { color: var(--accent); opacity: 0.75; }
    .terminal-tools { min-height: 48px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 12px; border-bottom: 1px solid var(--line); background: var(--panel-2); color: var(--muted); font-size: 13px; }
    .terminal-actions { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
    #terminal { margin: 0; height: calc(100vh - 238px); min-height: 560px; overflow: auto; overscroll-behavior: contain; padding: 16px; background: #101828; color: #e4e7ec; font: 13px/1.45 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; white-space: pre-wrap; }
    #terminal .b { font-weight: bold; } #terminal .dim { opacity: 0.6; } #terminal .i { font-style: italic; } #terminal .u { text-decoration: underline; }
    #terminal .c0 { color: #1c1c1c; } #terminal .c1 { color: #cc342d; } #terminal .c2 { color: #198844; } #terminal .c3 { color: #c4a000; }
    #terminal .c4 { color: #3971ed; } #terminal .c5 { color: #a36ac7; } #terminal .c6 { color: #3971ed; } #terminal .c7 { color: #c5c8c6; }
    #terminal .c8 { color: #545454; } #terminal .c9 { color: #f96a5d; } #terminal .c10 { color: #40d472; } #terminal .c11 { color: #f0c600; }
    #terminal .c12 { color: #6ea8fe; } #terminal .c13 { color: #d2a8ff; } #terminal .c14 { color: #79c0ff; } #terminal .c15 { color: #fff; }
    #terminal .bg0 { background: #1c1c1c; } #terminal .bg1 { background: #cc342d; } #terminal .bg2 { background: #198844; } #terminal .bg3 { background: #c4a000; }
    #terminal .bg4 { background: #3971ed; } #terminal .bg5 { background: #a36ac7; } #terminal .bg6 { background: #3971ed; } #terminal .bg7 { background: #c5c8c6; }
    #terminal .bg8 { background: #545454; } #terminal .bg9 { background: #f96a5d; } #terminal .bg10 { background: #40d472; } #terminal .bg11 { background: #f0c600; }
    #terminal .bg12 { background: #6ea8fe; } #terminal .bg13 { background: #d2a8ff; } #terminal .bg14 { background: #79c0ff; } #terminal .bg15 { background: #fff; }
    .terminal-input { display: grid; grid-template-columns: 1fr auto; gap: 10px; padding: 12px; border-top: 1px solid var(--line); background: var(--panel); }

    @media (max-width: 760px) {
      main, main.session-main { padding: 14px; }
      .grid.two { grid-template-columns: 1fr; gap: 14px; }
      header { height: auto; min-height: 50px; gap: 12px; padding: 10px 14px; flex-wrap: wrap; }
      nav { gap: 6px; }
      h1 { font-size: 22px; }
      .hero { display: grid; gap: 12px; }
      .hero.compact button.danger { width: 100%; }
      button, .button-link, .btn-sm { min-height: 44px; }
      .panel { padding: 14px; }
      .panel.narrow { max-width: none; margin: 20px auto; }
      .path { max-width: 200px; }
      .node-list { grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); }
      #terminal { height: calc(100vh - 200px); min-height: 420px; }
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
      #terminal { height: calc(100vh - 180px); min-height: 360px; padding: 12px; font-size: 12px; }
      .terminal-input { gap: 8px; padding: 10px; }
      table { min-width: 360px; }
      th, td { padding: 8px 6px; }
      th { font-size: 11px; }
    }
  `;
}
