import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SESSION_NAME_PATTERN = /^[A-Za-z0-9_.:-]{1,80}$/;

export function assertSessionName(name) {
  if (!SESSION_NAME_PATTERN.test(String(name || ""))) {
    const error = new Error("Session name may only contain letters, numbers, dot, underscore, colon, or dash");
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
  ].join("\t");

  let stdout = "";
  try {
    ({ stdout } = await execFileAsync("tmux", ["list-sessions", "-F", format]));
  } catch {
    return [];
  }

  const rows = [];
  for (const line of stdout.trim().split("\n")) {
    if (!line) continue;
    const [name, windows, attached, activity, created] = line.split("\t");
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
  const safeLines = Math.max(20, Math.min(Number(lines || 160), 500));
  if (!(await sessionExists(name))) {
    const error = new Error(`tmux session not found: ${name}`);
    error.statusCode = 404;
    throw error;
  }
  const { stdout } = await execFileAsync("tmux", ["capture-pane", "-e", "-t", tmuxTarget(name, windowIndex), "-p", "-S", `-${safeLines}`]);
  return stdout.replace(/\s+$/u, "");
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

export async function resizeWindow(name, cols, rows, windowIndex = "") {
  assertSessionName(name);
  const safeCols = Math.max(40, Math.min(Number(cols || 0), 300));
  const safeRows = Math.max(10, Math.min(Number(rows || 0), 120));
  if (!Number.isFinite(safeCols) || !Number.isFinite(safeRows)) {
    const error = new Error("Terminal size must include numeric cols and rows");
    error.statusCode = 400;
    throw error;
  }
  if (!(await sessionExists(name))) {
    const error = new Error(`tmux session not found: ${name}`);
    error.statusCode = 404;
    throw error;
  }
  await execFileAsync("tmux", [
    "resize-window",
    "-t",
    tmuxTarget(name, windowIndex),
    "-x",
    String(Math.round(safeCols)),
    "-y",
    String(Math.round(safeRows))
  ]);
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
  const target = tmuxTarget(name, windowIndex);
  await execFileAsync("tmux", ["send-keys", "-t", target, "-l", message]);
  await execFileAsync("tmux", ["send-keys", "-t", target, "Enter"]);
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
