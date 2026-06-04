import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const NODE_NAME_PATTERN = /^[A-Za-z0-9_.:-]{1,80}$/;

export function stateDir() {
  return process.env.TMUXFLEET_STATE_DIR || path.join(os.homedir(), ".local", "state", "tmuxfleet");
}

export function nodesPath() {
  return path.join(stateDir(), "nodes.json");
}

export function loadNodes() {
  const builtIn = [{ name: "local", url: "local", mode: "local" }];
  let saved = [];
  try {
    const data = JSON.parse(fs.readFileSync(nodesPath(), "utf8"));
    saved = Array.isArray(data.nodes) ? data.nodes : [];
  } catch {
    saved = [];
  }
  const nodes = new Map();
  for (const node of builtIn.concat(saved)) {
    const normalized = normalizeNode(node);
    nodes.set(normalized.name, normalized);
  }
  return Array.from(nodes.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function saveNodes(nodes) {
  fs.mkdirSync(stateDir(), { recursive: true });
  fs.writeFileSync(nodesPath(), JSON.stringify({ nodes }, null, 2) + "\n");
}

export function addNode({ name, url, mode }) {
  if (!NODE_NAME_PATTERN.test(String(name || ""))) {
    const error = new Error("Node name may only contain letters, numbers, dot, underscore, colon, or dash");
    error.statusCode = 400;
    throw error;
  }
  if (name === "local") {
    const error = new Error("local node is built in");
    error.statusCode = 400;
    throw error;
  }
  const entry = normalizeNode({ name, url, mode: mode || "remote" });
  const nodes = loadNodes().filter((node) => node.name !== "local" && node.name !== entry.name);
  nodes.push(entry);
  saveNodes(nodes.sort((a, b) => a.name.localeCompare(b.name)));
  return entry;
}

export function removeNode(name) {
  if (name === "local") {
    const error = new Error("local node cannot be removed");
    error.statusCode = 400;
    throw error;
  }
  saveNodes(loadNodes().filter((node) => node.name !== "local" && node.name !== name));
}

export function findNode(name) {
  const node = loadNodes().find((item) => item.name === name);
  if (!node) {
    const error = new Error(`node not found: ${name}`);
    error.statusCode = 404;
    throw error;
  }
  return node;
}

export function normalizeNode(node) {
  if (node.name === "local" || node.url === "local") {
    return { name: "local", url: "local", mode: "local" };
  }
  const url = normalizeUrl(node.url);
  return {
    name: String(node.name || "").trim(),
    url,
    mode: String(node.mode || "remote").trim() || "remote"
  };
}

function normalizeUrl(value) {
  const raw = String(value || "").trim().replace(/\/+$/u, "");
  if (!raw) {
    const error = new Error("Node URL is required");
    error.statusCode = 400;
    throw error;
  }
  if (/^https?:\/\//u.test(raw)) return raw;
  if (raw.includes("/") || raw.includes("?") || raw.includes("#")) {
    const error = new Error("Use a host, IP, or http(s) URL");
    error.statusCode = 400;
    throw error;
  }
  return raw.includes(":") ? `http://${raw}` : `http://${raw}:8091`;
}
