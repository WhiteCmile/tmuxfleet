import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { transcriptState } from "./transcript.js";

const execFileAsync = promisify(execFile);

const SESSION_NAME_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
const TMUXFLEET_FIELD_SEPARATOR = "|tmuxfleet|";

export function assertSessionName(name) {
  if (!SESSION_NAME_PATTERN.test(String(name || ""))) {
    const error = new Error("Session name may only contain letters, numbers, underscore, or dash");
    error.statusCode = 400;
    throw error;
  }
}

export async function tmuxAvailable() {
  try {
    await execFileAsync("tmux", ["-V"]);
    return true;
  } catch {
    return false;
  }
}

export async function listSessions() {
  const format = [
    "#{session_name}",
    "#{session_windows}",
    "#{session_attached}",
    "#{session_activity}",
    "#{session_created}"
  ].join(TMUXFLEET_FIELD_SEPARATOR);

  let stdout = "";
  try {
    ({ stdout } = await execFileAsync("tmux", ["list-sessions", "-F", format]));
  } catch {
    return [];
  }

  const rows = [];
  for (const { name, windows, attached, activity, created } of parseSessionListOutput(stdout)) {
    const pane = await activePane(name);
    rows.push({
      name,
      node: os.hostname(),
      windows: Number(windows || 0),
      attached: Number(attached || 0),
      activity: Number(activity || 0),
      created: Number(created || 0),
      cwd: pane.currentPath || "",
      command: pane.currentCommand || "",
      status: Number(attached || 0) > 0 ? "attached" : "detached",
      lastUpdated: Number(activity || 0) ? new Date(Number(activity) * 1000).toISOString() : null
    });
  }
  return rows;
}

export function parseSessionListOutput(stdout) {
  const rows = [];
  for (const line of String(stdout || "").trim().split("\n")) {
    if (!line) continue;
    const [name, windows, attached, activity, created] = line.split(TMUXFLEET_FIELD_SEPARATOR);
    if (!name || created === undefined) continue;
    rows.push({ name, windows, attached, activity, created });
  }
  return rows;
}

export async function activePane(sessionName) {
  assertSessionName(sessionName);
  return activePaneTarget(tmuxTarget(sessionName));
}

export async function activePaneTarget(target) {
  const format = "#{pane_current_path}\t#{pane_current_command}\t#{pane_pid}";
  try {
    const { stdout } = await execFileAsync("tmux", ["display-message", "-p", "-t", target, format]);
    const [currentPath, currentCommand, panePid] = stdout.trim().split("\t");
    return { currentPath, currentCommand, panePid: Number(panePid || 0) };
  } catch {
    return { currentPath: "", currentCommand: "", panePid: 0 };
  }
}

async function listPanesTarget(target) {
  const format = [
    "#{pane_current_path}",
    "#{pane_current_command}",
    "#{pane_pid}",
    "#{pane_index}",
    "#{pane_active}"
  ].join("\t");
  try {
    const { stdout } = await execFileAsync("tmux", ["list-panes", "-t", target, "-F", format]);
    return stdout.trim().split("\n").filter(Boolean).map((line) => {
      const [currentPath, currentCommand, panePid, paneIndex, active] = line.split("\t");
      return {
        currentPath: currentPath || "",
        currentCommand: currentCommand || "",
        panePid: Number(panePid || 0),
        paneIndex: Number(paneIndex || 0),
        active: active === "1"
      };
    });
  } catch {
    return [];
  }
}

export async function listWindows(sessionName) {
  assertSessionName(sessionName);
  if (!(await sessionExists(sessionName))) {
    const error = new Error(`tmux session not found: ${sessionName}`);
    error.statusCode = 404;
    throw error;
  }
  const format = [
    "#{window_index}",
    "#{window_name}",
    "#{window_active}",
    "#{window_panes}",
    "#{window_activity}",
    "#{pane_current_path}",
    "#{pane_current_command}"
  ].join("\t");
  const { stdout } = await execFileAsync("tmux", ["list-windows", "-t", sessionName, "-F", format]);
  return stdout.trim().split("\n").filter(Boolean).map((line) => {
    const [index, name, active, panes, activity, cwd, command] = line.split("\t");
    return {
      index: Number(index || 0),
      name: name || "",
      active: active === "1",
      panes: Number(panes || 0),
      activity: Number(activity || 0),
      cwd: cwd || "",
      command: command || "",
      lastUpdated: Number(activity || 0) ? new Date(Number(activity) * 1000).toISOString() : null
    };
  });
}

export async function sessionExists(name) {
  assertSessionName(name);
  try {
    await execFileAsync("tmux", ["has-session", "-t", name]);
    return true;
  } catch {
    return false;
  }
}

export async function createSession({ name, cwd, command }) {
  assertSessionName(name);
  const workingDirectory = path.resolve(String(cwd || process.cwd()));
  const shellCommand = String(command || "").trim();
  if (!shellCommand) {
    const error = new Error("Command is required");
    error.statusCode = 400;
    throw error;
  }
  if (await sessionExists(name)) {
    const error = new Error(`tmux session already exists: ${name}`);
    error.statusCode = 409;
    throw error;
  }
  await execFileAsync("tmux", ["new-session", "-d", "-s", name, "-c", workingDirectory, shellCommand]);
  return { name, cwd: workingDirectory, command: shellCommand };
}

export async function killSession(name) {
  assertSessionName(name);
  if (!(await sessionExists(name))) {
    const error = new Error(`tmux session not found: ${name}`);
    error.statusCode = 404;
    throw error;
  }
  await execFileAsync("tmux", ["kill-session", "-t", name]);
}

export async function captureOutput(name, lines = 160, windowIndex = "") {
  assertSessionName(name);
  const safeLines = Math.max(20, Math.min(Number(lines || 160), 2000));
  if (!(await sessionExists(name))) {
    const error = new Error(`tmux session not found: ${name}`);
    error.statusCode = 404;
    throw error;
  }
  const { stdout } = await execFileAsync("tmux", ["capture-pane", "-e", "-t", tmuxTarget(name, windowIndex), "-p", "-S", `-${safeLines}`]);
  return stdout.replace(/\s+$/u, "");
}

export async function sessionTranscriptState(name, lines = 500, windowIndex = "") {
  const output = await captureOutput(name, lines, windowIndex);
  const target = tmuxTarget(name, windowIndex);
  const panes = await listPanesTarget(target);
  const selected = selectTranscriptPaneFromRows(panes, await processRows());
  const pane = selected.pane || await activePaneTarget(target);
  const agent = selected.agent || { cli: "", pid: 0 };
  return transcriptState({
    output,
    cli: agent.cli || pane.currentCommand || "",
    panePid: agent.pid || pane.panePid || 0
  });
}

export async function inferAgentProcess(currentCommand, panePid) {
  return inferAgentProcessFromRows(currentCommand, panePid, await processRows());
}

export function inferAgentProcessFromRows(currentCommand, panePid, rows) {
  const direct = normalizeAgentCli(currentCommand);
  const children = new Map();
  for (const row of rows || []) {
    const ppid = Number(row.ppid || 0);
    if (!children.has(ppid)) children.set(ppid, []);
    children.get(ppid).push({
      pid: Number(row.pid || 0),
      command: String(row.command || "")
    });
  }
  const descendant = findDescendantAgent(children, Number(panePid || 0), direct || "");
  if (descendant.cli) return descendant;
  if (direct) return { cli: direct, pid: Number(panePid || 0) };
  return { cli: "", pid: 0 };
}

export function selectTranscriptPaneFromRows(panes, rows) {
  const list = Array.isArray(panes) ? panes.filter((pane) => pane && Number(pane.panePid || 0)) : [];
  const activePane = list.find((pane) => pane.active) || list[0] || null;
  const ordered = [
    ...list.filter((pane) => pane === activePane),
    ...list.filter((pane) => pane !== activePane)
  ];

  for (const pane of ordered) {
    const agent = inferAgentProcessFromRows(pane.currentCommand || "", pane.panePid || 0, rows);
    if (agent.cli) return { pane, agent };
  }

  return {
    pane: activePane,
    agent: { cli: "", pid: 0 }
  };
}

export function sendTargetForRows(sessionName, windowIndex, panes, rows) {
  const selected = selectTranscriptPaneFromRows(panes, rows);
  const pane = selected.pane || null;
  if (!pane || !selected.agent?.cli) return tmuxTarget(sessionName, windowIndex);
  const paneIndex = Number(pane.paneIndex);
  if (!Number.isInteger(paneIndex) || paneIndex < 0) return tmuxTarget(sessionName, windowIndex);
  if (windowIndex === "" || windowIndex === null || windowIndex === undefined) {
    return `${tmuxTarget(sessionName)}:.${paneIndex}`;
  }
  return `${tmuxTarget(sessionName, windowIndex)}.${paneIndex}`;
}

function findDescendantAgent(children, panePid, preferredCli = "") {
  const frontier = [{ pid: Number(panePid || 0), depth: 0 }];
  while (frontier.length) {
    const item = frontier.shift();
    if (!item || item.depth >= 3) continue;
    for (const child of children.get(item.pid) || []) {
      const cli = normalizeAgentCli(child.command);
      if (cli && (!preferredCli || preferredCli === cli)) return { cli, pid: child.pid };
      frontier.push({ pid: child.pid, depth: item.depth + 1 });
    }
  }
  return { cli: "", pid: 0 };
}

function normalizeAgentCli(command) {
  const base = path.basename(String(command || "")).toLowerCase();
  if (base === "codex" || base === "codex-cli") return "codex";
  if (base === "claude" || base === "claude-code") return "claude";
  return "";
}

async function processRows() {
  try {
    const { stdout } = await execFileAsync("ps", ["-eo", "pid=,ppid=,comm="]);
    return stdout.split("\n").map((line) => {
      const parts = line.trim().split(/\s+/, 3);
      if (parts.length < 3) return null;
      return {
        pid: Number(parts[0] || 0),
        ppid: Number(parts[1] || 0),
        command: parts[2] || ""
      };
    }).filter(Boolean);
  } catch {
    return [];
  }
}

export async function paneInMode(name, windowIndex = "") {
  assertSessionName(name);
  if (!(await sessionExists(name))) {
    const error = new Error(`tmux session not found: ${name}`);
    error.statusCode = 404;
    throw error;
  }
  const { stdout } = await execFileAsync("tmux", ["display-message", "-p", "-t", tmuxTarget(name, windowIndex), "#{pane_in_mode}"]);
  return stdout.trim() === "1";
}

export async function sendMessage(name, text, windowIndex = "") {
  assertSessionName(name);
  const message = String(text || "");
  if (!message.trim()) {
    const error = new Error("Message is empty");
    error.statusCode = 400;
    throw error;
  }
  if (!(await sessionExists(name))) {
    const error = new Error(`tmux session not found: ${name}`);
    error.statusCode = 404;
    throw error;
  }
  const target = sendTargetForRows(
    name,
    windowIndex,
    await listPanesTarget(tmuxTarget(name, windowIndex)),
    await processRows()
  );
  await execFileAsync("tmux", ["send-keys", "-t", target, "-l", message]);
  await execFileAsync("tmux", ["send-keys", "-t", target, "C-m"]);
}

export async function sendRawInput(name, data, windowIndex = "") {
  assertSessionName(name);
  if (!(await sessionExists(name))) {
    const error = new Error(`tmux session not found: ${name}`);
    error.statusCode = 404;
    throw error;
  }
  const value = String(data || "");
  if (!value) return;
  await execFileAsync("tmux", ["send-keys", "-t", tmuxTarget(name, windowIndex), "-l", value]);
}

export function tmuxTarget(sessionName, windowIndex = "") {
  assertSessionName(sessionName);
  if (windowIndex === "" || windowIndex === null || windowIndex === undefined) {
    return sessionName;
  }
  const value = String(windowIndex);
  if (!/^\d+$/.test(value)) {
    const error = new Error("Window index must be a non-negative integer");
    error.statusCode = 400;
    throw error;
  }
  return `${sessionName}:${value}`;
}
