import crypto from "node:crypto";
import http from "node:http";
import os from "node:os";

import { bearerToken, createRouter, listen, sendJson } from "./http.js";
import {
  captureOutput,
  createSession,
  killSession,
  listSessions,
  listWindows,
  paneInMode,
  sendMessage,
  tmuxAvailable
} from "./runtime.js";

const NODE_NAME_PATTERN = /^[A-Za-z0-9_.:-]{1,80}$/;
const POLL_DELAY_MS = 500;

export function startNodeServer({ host, port }) {
  const app = createRouter();

  app.add("GET", "/api/health", async ({ res }) => {
    sendJson(res, 200, { status: "ok", tmux: await tmuxAvailable() });
  });

  app.add("GET", "/api/sessions", withNodeAuth(async ({ res }) => {
    sendJson(res, 200, { sessions: await listSessions() });
  }));

  app.add("POST", "/api/sessions", withNodeAuth(async ({ res, body }) => {
    const payload = await body();
    const session = await createSession(payload);
    sendJson(res, 201, { status: "created", session });
  }));

  app.add("DELETE", "/api/sessions/:name", withNodeAuth(async ({ res, params }) => {
    await killSession(params.name);
    sendJson(res, 200, { status: "stopped", name: params.name });
  }));

  app.add("GET", "/api/sessions/:name/windows", withNodeAuth(async ({ res, params }) => {
    sendJson(res, 200, { windows: await listWindows(params.name) });
  }));

  app.add("GET", "/api/sessions/:name/output", withNodeAuth(async ({ res, params, url }) => {
    const windowIndex = url.searchParams.get("window") || "";
    const output = await captureOutput(
      params.name,
      url.searchParams.get("lines") || 160,
      windowIndex
    );
    sendJson(res, 200, { output, inMode: await paneInMode(params.name, windowIndex) });
  }));

  app.add("POST", "/api/sessions/:name/send", withNodeAuth(async ({ res, params, body }) => {
    const payload = await body();
    await sendMessage(params.name, payload.text, payload.window || "");
    sendJson(res, 200, { status: "sent" });
  }));

  const server = listen(app, host, port);
  console.log(`tmuxfleet node listening on http://${host}:${port}`);
  return server;
}

export async function startConnectedNode({ hub, name }) {
  const hubUrl = normalizeHubUrl(hub);
  const nodeName = normalizeNodeName(name || os.hostname());
  console.log(`tmuxfleet node ${nodeName} connecting to ${hubUrl}`);

  for (;;) {
    try {
      await registerWithHub(hubUrl, nodeName);
      const command = await requestHubJson(hubUrl, "POST", "/api/agent/poll", { name: nodeName });
      if (command?.id) {
        const result = await runNodeCommand(command).catch((error) => ({
          ok: false,
          status: Number(error.statusCode || 500),
          error: error.message || String(error)
        }));
        await requestHubJson(hubUrl, "POST", "/api/agent/result", {
          name: nodeName,
          id: command.id,
          ...result
        });
      } else {
        await sleep(POLL_DELAY_MS);
      }
    } catch (error) {
      console.error(`tmuxfleet node connection error: ${error.message || error}`);
      await sleep(2000);
    }
  }
}

async function registerWithHub(hubUrl, name) {
  await requestHubJson(hubUrl, "POST", "/api/agent/register", {
    name,
    hostname: os.hostname()
  });
}

async function runNodeCommand(command) {
  const method = String(command.method || "GET").toUpperCase();
  const path = String(command.path || "");
  const body = command.body || {};
  const url = new URL(path, "http://tmuxfleet.local");
  const parts = url.pathname.split("/").filter(Boolean);

  if (method === "GET" && url.pathname === "/api/sessions") {
    return { ok: true, status: 200, payload: { sessions: await listSessions() } };
  }
  if (method === "POST" && url.pathname === "/api/sessions") {
    return { ok: true, status: 201, payload: { status: "created", session: await createSession(body) } };
  }
  if (parts[0] === "api" && parts[1] === "sessions" && parts[2]) {
    const sessionName = decodeURIComponent(parts[2]);
    if (method === "DELETE" && parts.length === 3) {
      await killSession(sessionName);
      return { ok: true, status: 200, payload: { status: "stopped", name: sessionName } };
    }
    if (method === "GET" && parts[3] === "windows") {
      return { ok: true, status: 200, payload: { windows: await listWindows(sessionName) } };
    }
    if (method === "GET" && parts[3] === "output") {
      const windowIndex = url.searchParams.get("window") || "";
      const output = await captureOutput(
        sessionName,
        url.searchParams.get("lines") || 160,
        windowIndex
      );
      return { ok: true, status: 200, payload: { output, inMode: await paneInMode(sessionName, windowIndex) } };
    }
    if (method === "POST" && parts[3] === "send") {
      await sendMessage(sessionName, body.text, body.window || "");
      return { ok: true, status: 200, payload: { status: "sent" } };
    }
  }

  return { ok: false, status: 404, error: `Unsupported command: ${method} ${path}` };
}

export async function requestHubJson(hubUrl, method, path, body) {
  const token = nodeToken();
  if (!token) {
    throw new Error("TMUXFLEET_NODE_TOKEN is required");
  }
  const url = new URL(path, hubUrl).toString();
  const requestBody = JSON.stringify(body || {});
  const response = await fetchHub(url, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`
    },
    body: requestBody
  });
  let payload = {};
  try {
    payload = response.text ? JSON.parse(response.text) : {};
  } catch {
    payload = { detail: response.text };
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(payload.detail || `Hub request failed: ${response.status}`);
  }
  return payload;
}

async function fetchHub(url, options) {
  const proxy = hubHttpProxy(url);
  if (!proxy) {
    const response = await fetch(url, options);
    return { status: response.status, text: await response.text() };
  }
  return requestViaHttpProxy(proxy, url, options);
}

export function hubHttpProxy(url, env = process.env) {
  const target = new URL(url);
  if (target.protocol !== "http:") return "";
  return String(env.http_proxy || env.HTTP_PROXY || "").trim();
}

function requestViaHttpProxy(proxyUrl, targetUrl, options) {
  return new Promise((resolve, reject) => {
    const proxy = new URL(proxyUrl);
    const target = new URL(targetUrl);
    if (proxy.protocol !== "http:") {
      reject(new Error(`Unsupported Hub proxy protocol: ${proxy.protocol}`));
      return;
    }

    const headers = {
      ...options.headers,
      host: target.host,
      "content-length": Buffer.byteLength(options.body || "")
    };
    if (proxy.username || proxy.password) {
      const username = decodeURIComponent(proxy.username);
      const password = decodeURIComponent(proxy.password);
      headers["proxy-authorization"] = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
    }

    const req = http.request({
      host: proxy.hostname,
      port: Number(proxy.port || 80),
      method: options.method,
      path: targetUrl,
      headers,
      timeout: 30000
    }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode || 0, text }));
    });
    req.on("timeout", () => req.destroy(new Error("Hub proxy request timed out")));
    req.on("error", reject);
    req.end(options.body || "");
  });
}

function withNodeAuth(handler) {
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

export function nodeToken() {
  return String(process.env.TMUXFLEET_NODE_TOKEN || process.env.TMUXFLEET_HUB_TOKEN || "").trim();
}

function normalizeHubUrl(value) {
  const raw = String(value || "").trim().replace(/\/+$/u, "");
  if (!raw) {
    throw new Error("--connect requires a Hub URL");
  }
  if (!/^https?:\/\//u.test(raw)) {
    throw new Error("--connect must be an http(s) URL");
  }
  return raw;
}

function normalizeNodeName(value) {
  const name = String(value || "").trim();
  if (!NODE_NAME_PATTERN.test(name)) {
    throw new Error("Node name may only contain letters, numbers, dot, underscore, colon, or dash");
  }
  if (name === "local") {
    throw new Error("local is reserved for the Hub machine");
  }
  return name;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
