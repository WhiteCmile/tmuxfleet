import crypto from "node:crypto";
import fs from "node:fs";

import {
  AUTO_RECOVER_COOLDOWN_MS,
  markSmartRecoverReviewed,
  recentOutputForReview,
  SMART_RECOVER_STALE_MS,
  updateSmartRecoverObservation,
  shouldSendAutoRecover
} from "./auto_recover.js";
import {
  captureOutput,
  createSession,
  killSession,
  listSessions,
  listWindows,
  paneInMode,
  sendMessage,
  sessionTranscriptState
} from "./runtime.js";
import {
  bearerToken,
  createRouter,
  listen,
  parseCookies,
  redirect,
  sendError,
  sendHtml,
  sendJson
} from "./http.js";
import {
  addNode,
  loadAutoRecoverSessions,
  loadHiddenSessions,
  loadNodes,
  removeNode,
  setSessionAutoRecover,
  setSessionHidden
} from "./state.js";
import { nodeToken } from "./node_server.js";

const AUTH_COOKIE = "tmuxfleet_auth";
const NODE_NAME_PATTERN = /^[A-Za-z0-9_.:-]{1,80}$/;
const AGENT_COMMAND_TIMEOUT_MS = 15000;
const AGENT_POLL_TIMEOUT_MS = 25000;
const AGENT_ONLINE_MS = 35000;
const AUTO_RECOVER_INTERVAL_MS = 20000;
const SMART_RECOVER_LLM_TIMEOUT_MS = 15000;
const SMART_RECOVER_CONFIDENCE = 0.8;

const connectedNodes = new Map();
const autoRecoverHistory = new Map();

export function startHubServer({ host, port }) {
  ensureHubAuthForBind(host);

  const app = createRouter();

  app.add("GET", "/", async ({ res }) => redirect(res, "/sessions"));

  app.add("GET", "/login", async ({ res, url }) => {
    const next = safeNext(url.searchParams.get("next") || "/sessions");
    sendHtml(res, 200, await renderPage("登录", loginForm(next, "")));
  });

  app.add("POST", "/login", async ({ req, res }) => {
    const form = await readForm(req);
    const next = safeNext(form.next || "/sessions");
    if (validHubToken(form.token || "")) {
      res.writeHead(303, {
        location: next,
        "set-cookie": `${AUTH_COOKIE}=${encodeURIComponent(form.token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`
      });
      res.end();
      return;
    }
    sendHtml(res, 401, await renderPage("登录", loginForm(next, "Token 不正确")));
  });

  app.add("POST", "/logout", requireHubAuth(async ({ res }) => {
    res.writeHead(303, {
      location: "/login",
      "set-cookie": `${AUTH_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
    });
    res.end();
  }));

  app.add("GET", "/sessions", requireHubAuth(async ({ res }) => {
    const nodeViews = await collectNodeViews();
    const views = await loadViews();
    sendHtml(res, 200, views.renderSessionsPage(nodeViews));
  }));

  app.add("GET", "/nodes", requireHubAuth(async ({ res }) => {
    const nodeViews = await collectNodeViews();
    const views = await loadViews();
    sendHtml(res, 200, views.renderNodesPage(nodeViews));
  }));

  app.add("GET", "/sessions/:node/:name", requireHubAuth(async ({ res, params, url }) => {
    const node = findHubNode(params.node);
    const selectedWindow = url.searchParams.get("window") || "";
    const windows = await sessionWindows(node, params.name);
    const output = await sessionOutput(node, params.name, 2000, selectedWindow);
    const transcript = await sessionTranscript(node, params.name, 500, selectedWindow);
    const autoRecoverConfig = loadAutoRecoverSessions()[`${node.name}/${params.name}`] || null;
    const views = await loadViews();
    sendHtml(res, 200, views.renderSessionPage({
      node,
      name: params.name,
      windows,
      selectedWindow,
      output,
      transcript,
      autoRecoverConfig
    }));
  }));

  app.add("GET", "/api/nodes", requireHubAuth(async ({ res }) => {
    sendJson(res, 200, { nodes: loadHubNodes() });
  }));

  app.add("POST", "/api/nodes", requireHubAuth(async ({ res, body }) => {
    const entry = addNode(await body());
    sendJson(res, 201, { status: "created", node: entry });
  }));

  app.add("DELETE", "/api/nodes/:name", requireHubAuth(async ({ res, params }) => {
    removeNode(params.name);
    sendJson(res, 200, { status: "removed", name: params.name });
  }));

  app.add("GET", "/api/sessions", requireHubAuth(async ({ res }) => {
    const nodeViews = await collectNodeViews();
    sendJson(res, 200, { nodes: nodeViews });
  }));

  app.add("POST", "/api/sessions", requireHubAuth(async ({ res, body }) => {
    const payload = await body();
    const node = findHubNode(payload.node || "local");
    const result = await createNodeSession(node, payload);
    sendJson(res, 201, result);
  }));

  app.add("DELETE", "/api/sessions/:node/:name", requireHubAuth(async ({ res, params }) => {
    const node = findHubNode(params.node);
    await stopNodeSession(node, params.name);
    sendJson(res, 200, { status: "stopped", node: node.name, name: params.name });
  }));

  app.add("GET", "/api/sessions/:node/:name/windows", requireHubAuth(async ({ res, params }) => {
    const node = findHubNode(params.node);
    sendJson(res, 200, { windows: await sessionWindows(node, params.name) });
  }));

  app.add("GET", "/api/sessions/:node/:name/output", requireHubAuth(async ({ res, params, url }) => {
    const node = findHubNode(params.node);
    const output = await sessionOutputPayload(
      node,
      params.name,
      url.searchParams.get("lines") || 160,
      url.searchParams.get("window") || ""
    );
    sendJson(res, 200, output);
  }));

  app.add("GET", "/api/sessions/:node/:name/transcript-state", requireHubAuth(async ({ res, params, url }) => {
    const node = findHubNode(params.node);
    sendJson(res, 200, await sessionTranscript(
      node,
      params.name,
      url.searchParams.get("lines") || 500,
      url.searchParams.get("window") || ""
    ));
  }));

  app.add("POST", "/api/sessions/:node/:name/send", requireHubAuth(async ({ res, params, body }) => {
    const node = findHubNode(params.node);
    const payload = await body();
    await sendNodeMessage(node, params.name, payload.text, payload.window || "");
    sendJson(res, 200, { status: "sent" });
  }));

  app.add("PUT", "/api/sessions/:node/:name/hide", requireHubAuth(async ({ res, params, body }) => {
    const node = findHubNode(params.node);
    const payload = await body();
    const hidden = !!payload.hidden;
    setSessionHidden(node.name, params.name, hidden);
    sendJson(res, 200, { status: "ok", hidden });
  }));

  app.add("PUT", "/api/sessions/:node/:name/autorecover", requireHubAuth(async ({ res, params, body }) => {
    const node = findHubNode(params.node);
    const payload = await body();
    const config = setSessionAutoRecover(node.name, params.name, {
      enabled: !!payload.enabled,
      window: payload.window || "",
      message: payload.message || "go on",
      smart: !!payload.smart
    });
    sendJson(res, 200, { status: "ok", enabled: !!config, config });
  }));

  app.add("POST", "/api/agent/register", requireAgentAuth(async ({ res, body }) => {
    const payload = await body();
    const entry = touchConnectedNode(payload.name, payload.hostname);
    sendJson(res, 200, { status: "registered", node: publicConnectedNode(entry) });
  }));

  app.add("POST", "/api/agent/poll", requireAgentAuth(async ({ res, body }) => {
    const payload = await body();
    const entry = touchConnectedNode(payload.name);
    const command = await nextConnectedCommand(entry);
    sendJson(res, 200, command || { status: "idle" });
  }));

  app.add("POST", "/api/agent/result", requireAgentAuth(async ({ res, body }) => {
    const payload = await body();
    const entry = touchConnectedNode(payload.name);
    completeConnectedCommand(entry, payload);
    sendJson(res, 200, { status: "accepted" });
  }));

  const server = listen(app, host, port);
  const stopAutoRecoverLoop = startAutoRecoverLoop();
  server.on("close", stopAutoRecoverLoop);
  console.log(`tmuxfleet hub listening on http://${host}:${port}`);
  return server;
}

export async function collectNodeViews() {
  const views = [];
  for (const node of loadHubNodes()) {
    if (node.mode === "local") {
      views.push({ ...node, status: "connected", sessions: await withNodeName(node, listSessions()) });
      continue;
    }
    if (node.mode === "connected") {
      try {
        const payload = await requestConnectedNodeJson(node, "GET", "/api/sessions");
        views.push({ ...node, status: "connected", sessions: await withNodeName(node, payload.sessions || []) });
      } catch (error) {
        views.push({ ...node, status: "disconnected", error: error.message, sessions: [] });
      }
      continue;
    }
    try {
      const payload = await requestNodeJson(node, "GET", "/api/sessions");
      views.push({ ...node, status: "connected", sessions: await withNodeName(node, payload.sessions || []) });
    } catch (error) {
      views.push({ ...node, status: "disconnected", error: error.message, sessions: [] });
    }
  }
  const hiddenSessions = loadHiddenSessions();
  const autoRecoverSessions = loadAutoRecoverSessions();
  for (const view of views) {
    for (const session of view.sessions) {
      const key = `${view.name}/${session.name}`;
      session.hidden = !!hiddenSessions[key];
      session.autoRecover = autoRecoverSessions[key] || null;
    }
  }
  return views;
}

async function withNodeName(node, sessionsOrPromise) {
  const sessions = await sessionsOrPromise;
  return sessions.map((session) => ({ ...session, node: node.name }));
}

async function createNodeSession(node, payload) {
  const body = { name: payload.name, cwd: payload.cwd, command: payload.command };
  if (node.mode === "local") {
    return { status: "created", session: await createSession(body) };
  }
  if (node.mode === "connected") {
    return requestConnectedNodeJson(node, "POST", "/api/sessions", body);
  }
  return requestNodeJson(node, "POST", "/api/sessions", body);
}

async function stopNodeSession(node, name) {
  if (node.mode === "local") {
    await killSession(name);
    return;
  }
  if (node.mode === "connected") {
    await requestConnectedNodeJson(node, "DELETE", `/api/sessions/${encodeURIComponent(name)}`);
    return;
  }
  await requestNodeJson(node, "DELETE", `/api/sessions/${encodeURIComponent(name)}`);
}

async function sessionWindows(node, name) {
  if (node.mode === "local") return listWindows(name);
  if (node.mode === "connected") {
    const payload = await requestConnectedNodeJson(node, "GET", `/api/sessions/${encodeURIComponent(name)}/windows`);
    return payload.windows || [];
  }
  const payload = await requestNodeJson(node, "GET", `/api/sessions/${encodeURIComponent(name)}/windows`);
  return payload.windows || [];
}

async function sessionOutput(node, name, lines, windowIndex = "") {
  const payload = await sessionOutputPayload(node, name, lines, windowIndex);
  return payload.output || "";
}

async function sessionOutputPayload(node, name, lines, windowIndex = "") {
  if (node.mode === "local") {
    return {
      output: await captureOutput(name, lines, windowIndex),
      inMode: await paneInMode(name, windowIndex)
    };
  }
  const query = new URLSearchParams({ lines: String(lines) });
  if (windowIndex !== "") query.set("window", String(windowIndex));
  if (node.mode === "connected") {
    const payload = await requestConnectedNodeJson(node, "GET", `/api/sessions/${encodeURIComponent(name)}/output?${query.toString()}`);
    return { output: payload.output || "", inMode: !!payload.inMode };
  }
  const payload = await requestNodeJson(node, "GET", `/api/sessions/${encodeURIComponent(name)}/output?${query.toString()}`);
  return { output: payload.output || "", inMode: !!payload.inMode };
}

async function sessionTranscript(node, name, lines, windowIndex = "") {
  if (node.mode === "local") {
    return sessionTranscriptState(name, lines, windowIndex);
  }
  const query = new URLSearchParams({ lines: String(lines) });
  if (windowIndex !== "") query.set("window", String(windowIndex));
  try {
    if (node.mode === "connected") {
      return await requestConnectedNodeJson(node, "GET", `/api/sessions/${encodeURIComponent(name)}/transcript-state?${query.toString()}`);
    }
    return await requestNodeJson(node, "GET", `/api/sessions/${encodeURIComponent(name)}/transcript-state?${query.toString()}`);
  } catch (error) {
    const fallback = await sessionOutputPayload(node, name, lines, windowIndex);
    return transcriptFallback(fallback.output || "");
  }
}

function transcriptFallback(output) {
  const text = String(output || "").trim();
  return {
    messages: text ? [{ role: "agent", text, time: 0, id: "" }] : [],
    reply: text,
    completedReply: text,
    working: false,
    workingLabel: "",
    final: !!text
  };
}

async function sendNodeMessage(node, name, text, windowIndex = "") {
  if (node.mode === "local") {
    await sendMessage(name, text, windowIndex);
    return;
  }
  if (node.mode === "connected") {
    await requestConnectedNodeJson(node, "POST", `/api/sessions/${encodeURIComponent(name)}/send`, {
      text,
      window: windowIndex
    });
    return;
  }
  await requestNodeJson(node, "POST", `/api/sessions/${encodeURIComponent(name)}/send`, {
    text,
    window: windowIndex
  });
}

function startAutoRecoverLoop() {
  const timer = setInterval(() => {
    runAutoRecoverScan().catch((error) => {
      console.error(`tmuxfleet auto-recover scan error: ${error.message || error}`);
    });
  }, AUTO_RECOVER_INTERVAL_MS);
  const firstScanTimer = setTimeout(() => {
    runAutoRecoverScan().catch((error) => {
      console.error(`tmuxfleet auto-recover scan error: ${error.message || error}`);
    });
  }, 5000);
  return () => {
    clearInterval(timer);
    clearTimeout(firstScanTimer);
  };
}

async function runAutoRecoverScan() {
  const configs = loadAutoRecoverSessions();
  const entries = Object.entries(configs);
  if (!entries.length) return;
  for (const [key, config] of entries) {
    const [nodeName, sessionName] = key.split("/");
    if (!nodeName || !sessionName) continue;
    await scanAutoRecoverSession(nodeName, sessionName, config);
  }
}

async function scanAutoRecoverSession(nodeName, sessionName, config) {
  let node;
  try {
    node = findHubNode(nodeName);
  } catch {
    return;
  }
  const windowIndex = String(config.window ?? "");
  const message = String(config.message || "go on");
  let output = "";
  try {
    output = await sessionOutput(node, sessionName, 160, windowIndex);
  } catch (error) {
    console.error(`tmuxfleet auto-recover skipped ${nodeName}/${sessionName}: ${error.message || error}`);
    return;
  }
  const historyKey = `${nodeName}/${sessionName}:${windowIndex}`;
  const previous = autoRecoverHistory.get(historyKey);
  const now = Date.now();
  const decision = shouldSendAutoRecover({ output, previous, now, cooldownMs: AUTO_RECOVER_COOLDOWN_MS });
  if (decision.send) {
    await sendNodeMessage(node, sessionName, message, windowIndex);
    autoRecoverHistory.set(historyKey, { ...previous, fingerprint: decision.fingerprint, sentAt: now });
    console.log(`tmuxfleet auto-recover sent "${message}" to ${nodeName}/${sessionName}${windowIndex !== "" ? `:${windowIndex}` : ""}`);
    return;
  }
  if (!config.smart) return;

  const smartDecision = updateSmartRecoverObservation({
    output,
    previous,
    now,
    staleMs: SMART_RECOVER_STALE_MS
  });
  autoRecoverHistory.set(historyKey, smartDecision.observation || {});
  if (!smartDecision.review) return;

  const review = await reviewSmartRecover({
    nodeName,
    sessionName,
    windowIndex,
    output: recentOutputForReview(output)
  });
  const reviewedHistory = markSmartRecoverReviewed(
    autoRecoverHistory.get(historyKey),
    smartDecision.fingerprint,
    Date.now()
  );
  autoRecoverHistory.set(historyKey, reviewedHistory);
  if (!review.shouldSend) return;
  await sendNodeMessage(node, sessionName, message, windowIndex);
  autoRecoverHistory.set(historyKey, {
    ...reviewedHistory,
    fingerprint: smartDecision.fingerprint,
    sentAt: Date.now()
  });
  console.log(`tmuxfleet smart-recover sent "${message}" to ${nodeName}/${sessionName}${windowIndex !== "" ? `:${windowIndex}` : ""}: ${review.reason || "LLM approved"}`);
}

async function reviewSmartRecover({ nodeName, sessionName, windowIndex, output }) {
  const settings = smartRecoverSettings();
  if (!settings.enabled) return { shouldSend: false, reason: settings.reason };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SMART_RECOVER_LLM_TIMEOUT_MS);
  try {
    const response = await fetch(settings.url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${settings.key}`
      },
      body: JSON.stringify({
        model: settings.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "You judge whether a tmux terminal running an AI coding agent is stuck because of a transient API/network interruption.",
              "Return strict JSON only with keys: should_send_go_on(boolean), confidence(number 0-1), reason(string).",
              "Only approve go on when the agent appears interrupted or waiting after a recoverable network/API failure.",
              "Do not approve if the task appears complete, is waiting for normal user input, or the output is ambiguous."
            ].join(" ")
          },
          {
            role: "user",
            content: [
              `Session: ${nodeName}/${sessionName}${windowIndex !== "" ? `:${windowIndex}` : ""}`,
              "Recent terminal output:",
              output
            ].join("\n\n")
          }
        ]
      })
    });
    const text = await response.text();
    if (!response.ok) {
      return { shouldSend: false, reason: `LLM request failed: ${response.status}` };
    }
    const payload = text ? JSON.parse(text) : {};
    const content = payload.choices?.[0]?.message?.content || "{}";
    const decision = JSON.parse(content);
    const confidence = Number(decision.confidence || 0);
    return {
      shouldSend: decision.should_send_go_on === true && confidence >= SMART_RECOVER_CONFIDENCE,
      confidence,
      reason: String(decision.reason || "")
    };
  } catch (error) {
    return { shouldSend: false, reason: `LLM review failed: ${error.message || error}` };
  } finally {
    clearTimeout(timeout);
  }
}

function smartRecoverSettings() {
  const url = String(process.env.TMUXFLEET_RECOVERY_LLM_URL || "").trim();
  const key = String(process.env.TMUXFLEET_RECOVERY_LLM_KEY || "").trim();
  const model = String(process.env.TMUXFLEET_RECOVERY_LLM_MODEL || "deepseek-chat").trim();
  if (!url) return { enabled: false, reason: "TMUXFLEET_RECOVERY_LLM_URL is not set" };
  if (!key) return { enabled: false, reason: "TMUXFLEET_RECOVERY_LLM_KEY is not set" };
  return { enabled: true, url, key, model };
}

function loadHubNodes() {
  const nodes = new Map();
  for (const node of loadNodes()) {
    nodes.set(node.name, node);
  }
  for (const node of connectedNodes.values()) {
    nodes.set(node.name, publicConnectedNode(node));
  }
  return Array.from(nodes.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function findHubNode(name) {
  const node = loadHubNodes().find((item) => item.name === name);
  if (!node) {
    const error = new Error(`node not found: ${name}`);
    error.statusCode = 404;
    throw error;
  }
  return node;
}

function touchConnectedNode(name, hostname = "") {
  const nodeName = normalizeConnectedNodeName(name);
  let entry = connectedNodes.get(nodeName);
  if (!entry) {
    entry = {
      name: nodeName,
      hostname: String(hostname || ""),
      mode: "connected",
      url: "connected",
      queue: [],
      waiters: [],
      pending: new Map(),
      registeredAt: Date.now(),
      lastSeen: Date.now()
    };
    connectedNodes.set(nodeName, entry);
  }
  if (hostname) entry.hostname = String(hostname);
  entry.lastSeen = Date.now();
  return entry;
}

function publicConnectedNode(entry) {
  return {
    name: entry.name,
    url: entry.hostname ? `connected:${entry.hostname}` : "connected",
    mode: "connected",
    lastSeen: new Date(entry.lastSeen).toISOString()
  };
}

function normalizeConnectedNodeName(value) {
  const name = String(value || "").trim();
  if (!NODE_NAME_PATTERN.test(name)) {
    const error = new Error("Node name may only contain letters, numbers, dot, underscore, colon, or dash");
    error.statusCode = 400;
    throw error;
  }
  if (name === "local") {
    const error = new Error("local is reserved for the Hub machine");
    error.statusCode = 400;
    throw error;
  }
  return name;
}

async function requestConnectedNodeJson(node, method, path, body) {
  const entry = connectedNodes.get(node.name);
  if (!entry || Date.now() - entry.lastSeen > AGENT_ONLINE_MS) {
    const error = new Error(`connected node is offline: ${node.name}`);
    error.statusCode = 503;
    throw error;
  }
  const id = crypto.randomUUID();
  const command = { id, method, path, body };
  const response = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      entry.pending.delete(id);
      reject(Object.assign(new Error(`connected node timed out: ${node.name}`), { statusCode: 504 }));
    }, AGENT_COMMAND_TIMEOUT_MS);
    entry.pending.set(id, { resolve, reject, timeout });
    enqueueConnectedCommand(entry, command);
  });
  return response;
}

function enqueueConnectedCommand(entry, command) {
  const waiter = entry.waiters.shift();
  if (waiter) {
    waiter(command);
    return;
  }
  entry.queue.push(command);
}

function nextConnectedCommand(entry) {
  const command = entry.queue.shift();
  if (command) return Promise.resolve(command);
  return new Promise((resolve) => {
    const waiter = (item) => {
      clearTimeout(timeout);
      resolve(item);
    };
    const timeout = setTimeout(() => {
      entry.waiters = entry.waiters.filter((item) => item !== waiter);
      resolve(null);
    }, AGENT_POLL_TIMEOUT_MS);
    entry.waiters.push(waiter);
  });
}

function completeConnectedCommand(entry, payload) {
  const pending = entry.pending.get(payload.id);
  if (!pending) return;
  clearTimeout(pending.timeout);
  entry.pending.delete(payload.id);
  if (payload.ok) {
    pending.resolve(payload.payload || {});
    return;
  }
  const error = new Error(payload.error || "Connected node command failed");
  error.statusCode = Number(payload.status || 500);
  pending.reject(error);
}

async function requestNodeJson(node, method, path, body) {
  const token = nodeToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(new URL(path, node.url).toString(), {
      method,
      signal: controller.signal,
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { detail: text };
    }
    if (!response.ok) {
      const error = new Error(payload.detail || `Node request failed: ${response.status}`);
      error.statusCode = response.status;
      throw error;
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function requireHubAuth(handler) {
  return async (request) => {
    if (!hubToken()) {
      await handler(request);
      return;
    }
    const cookies = parseCookies(request.req);
    const token = cookies[AUTH_COOKIE] || bearerToken(request.req);
    if (validHubToken(token)) {
      await handler(request);
      return;
    }
    if (acceptsHtml(request.req)) {
      redirect(request.res, `/login?next=${encodeURIComponent(request.url.pathname)}`);
      return;
    }
    request.res.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
    request.res.end("Unauthorized");
  };
}

function requireAgentAuth(handler) {
  return async (request) => {
    const token = nodeToken();
    if (!token) {
      request.res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
      request.res.end("TMUXFLEET_NODE_TOKEN is required");
      return;
    }
    if (!safeEqual(bearerToken(request.req), token)) {
      request.res.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
      request.res.end("Unauthorized");
      return;
    }
    await handler(request);
  };
}

function validHubToken(value) {
  const token = hubToken();
  if (!token) return true;
  return safeEqual(value, token);
}

function hubToken() {
  return String(process.env.TMUXFLEET_HUB_TOKEN || "").trim();
}

function ensureHubAuthForBind(host) {
  const value = String(host || "").toLowerCase();
  const loopback = value === "localhost" || value === "127.0.0.1" || value === "::1";
  if (!loopback && !hubToken()) {
    throw new Error("TMUXFLEET_HUB_TOKEN is required when binding Hub to a non-loopback address");
  }
}

function acceptsHtml(req) {
  return String(req.headers.accept || "").includes("text/html");
}

function safeNext(value) {
  const next = String(value || "/sessions");
  return next.startsWith("/") && !next.startsWith("//") ? next : "/sessions";
}

async function readForm(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const params = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
  return Object.fromEntries(params.entries());
}

function loginForm(next, error) {
  return `
    <section class="panel narrow">
      <h1>tmuxfleet</h1>
      <form method="post" action="/login" class="stack">
        <input type="hidden" name="next" value="${escapeHtml(next)}">
        <label>Hub Token <input name="token" type="password" autofocus></label>
        ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
        <button type="submit">登录</button>
      </form>
    </section>
  `;
}

async function renderPage(title, body) {
  const views = await loadViews();
  return views.page(title, body);
}

async function loadViews() {
  const viewUrl = new URL("./views.js", import.meta.url);
  const mtime = fs.statSync(viewUrl).mtimeMs;
  return import(`./views.js?mtime=${mtime}`);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
