import http from "node:http";
import { URL } from "node:url";

export function createRouter() {
  const routes = [];
  return {
    add(method, pattern, handler) {
      routes.push({ method, pattern: compilePattern(pattern), handler });
    },
    async handle(req, res) {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      for (const route of routes) {
        if (route.method !== req.method) continue;
        const match = route.pattern.regex.exec(url.pathname);
        if (!match) continue;
        const params = {};
        route.pattern.keys.forEach((key, index) => {
          params[key] = decodeURIComponent(match[index + 1]);
        });
        const request = { req, res, url, params, body: () => readJson(req) };
        try {
          await route.handler(request);
        } catch (error) {
          sendError(res, error);
        }
        return;
      }
      sendJson(res, 404, { error: "not_found", detail: "Route not found" });
    }
  };
}

export function listen(app, host, port) {
  const server = http.createServer((req, res) => app.handle(req, res));
  server.listen(port, host);
  return server;
}

export function sendJson(res, statusCode, payload, headers = {}) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    ...headers
  });
  res.end(body);
}

export function sendHtml(res, statusCode, body, headers = {}) {
  res.writeHead(statusCode, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    ...headers
  });
  res.end(body);
}

export function redirect(res, location) {
  res.writeHead(303, { location });
  res.end();
}

export async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

export function sendError(res, error) {
  const statusCode = Number(error.statusCode || 500);
  sendJson(res, statusCode, {
    error: statusCode >= 500 ? "internal_error" : "request_error",
    detail: error.message || String(error)
  });
}

export function bearerToken(req) {
  const header = req.headers.authorization || "";
  const [scheme, token] = String(header).split(/\s+/, 2);
  return scheme?.toLowerCase() === "bearer" ? token || "" : "";
}

export function parseCookies(req) {
  const cookies = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (!key) continue;
    cookies[key] = decodeURIComponent(rest.join("="));
  }
  return cookies;
}

function compilePattern(pattern) {
  const keys = [];
  const source = pattern
    .split("/")
    .map((part) => {
      if (part.startsWith(":")) {
        keys.push(part.slice(1));
        return "([^/]+)";
      }
      return escapeRegExp(part);
    })
    .join("/");
  return { regex: new RegExp(`^${source}$`), keys };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
