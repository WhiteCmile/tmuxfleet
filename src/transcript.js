import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SESSION_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function transcriptState({ output = "", cli = "", panePid = 0 }) {
  const normalizedCli = String(cli || "").toLowerCase();
  if (normalizedCli.includes("codex")) {
    const codex = await codexTranscriptFromPid(panePid);
    if (codex.messages.length) return codex;
  }
  if (normalizedCli.includes("claude")) {
    const claude = await claudeTranscriptFromPid(panePid);
    if (claude.messages.length) return claude;
  }
  return parseTranscriptFromOutput(output);
}

export function parseCodexJsonlTranscript(text) {
  const events = [];
  let lineNumber = 0;
  for (const item of readJsonl(text)) {
    lineNumber += 1;
    const event = codexEventFromJson(item, lineNumber);
    if (event) events.push(event);
  }
  const messages = events
    .filter((event) => event.kind === "user" || event.kind === "assistant_final")
    .map((event) => ({
      role: event.kind === "user" ? "user" : "agent",
      text: event.text,
      time: event.time,
      id: event.id
    }));
  const latestUser = latestEventIndex(events, "user");
  const latestAssistant = latestEventIndex(events, "assistant_final");
  const reply = latestAssistant >= 0 ? events[latestAssistant].text : "";
  const working = latestUser > latestAssistant;
  return transcriptPayload({
    messages,
    reply,
    completedReply: reply,
    working,
    workingLabel: working ? "Working" : "",
    final: !!reply && !working
  });
}

export function parseClaudeJsonlTranscript(text) {
  const events = readJsonl(text);
  const messages = claudeMessagesFromEvents(events);
  const latestUser = latestClaudeUserIndex(events);
  const latestAssistant = latestClaudeAssistantIndex(events);
  const reply = latestClaudeAssistantText(events);
  const working = latestUser > latestAssistant;
  return transcriptPayload({
    messages,
    reply,
    completedReply: reply,
    working,
    workingLabel: working ? "Working" : "",
    final: !!reply && !working
  });
}

export function parseTranscriptFromOutput(output) {
  const text = stripTerminalCodes(output).trimEnd();
  if (!text.trim()) return transcriptPayload();
  const visibleLines = text.split("\n").filter((line) => !isHiddenOutputLine(line.trim()));
  while (visibleLines.length && !visibleLines[0].trim()) visibleLines.shift();
  while (visibleLines.length && !visibleLines[visibleLines.length - 1].trim()) visibleLines.pop();
  const reply = visibleLines.join("\n").trim();
  return transcriptPayload({
    messages: reply ? [{ role: "agent", text: reply, time: 0, id: "" }] : [],
    reply,
    completedReply: reply,
    final: !!reply
  });
}

async function codexTranscriptFromPid(pid) {
  const filePath = await findCodexRolloutByPid(pid);
  if (!filePath) return transcriptPayload();
  const text = await readTextFile(filePath);
  return text ? parseCodexJsonlTranscript(text) : transcriptPayload();
}

async function claudeTranscriptFromPid(pid) {
  const filePath = await findClaudeJsonlByPid(pid);
  if (!filePath) return transcriptPayload();
  const text = await readTextFile(filePath);
  return text ? parseClaudeJsonlTranscript(text) : transcriptPayload();
}

async function findCodexRolloutByPid(pid) {
  for (const target of await processFileDescriptors(pid)) {
    if (isCodexRolloutPath(target)) return target;
  }
  return "";
}

function isCodexRolloutPath(value) {
  return /\/\.codex\/sessions\//.test(value)
    && /rollout-.*-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i.test(value);
}

async function findClaudeJsonlByPid(pid) {
  const state = await readClaudePidState(pid);
  if (state?.sessionId && state?.cwd) {
    const candidate = claudeJsonlPathForSession(String(state.sessionId), String(state.cwd));
    if (await fileExists(candidate)) return candidate;
  }
  for (const target of await processFileDescriptors(pid)) {
    if (target.endsWith(".jsonl") && target.includes("/.claude/projects/")) {
      const sessionId = path.basename(target, ".jsonl");
      if (SESSION_UUID_PATTERN.test(sessionId)) return target;
    }
  }
  return "";
}

async function readClaudePidState(pid) {
  if (!Number.isFinite(Number(pid)) || Number(pid) <= 0) return null;
  const statePath = path.join(os.homedir(), ".claude", "sessions", `${Number(pid)}.json`);
  try {
    const data = JSON.parse(await fs.promises.readFile(statePath, "utf8"));
    return data && Number(data.pid) === Number(pid) ? data : null;
  } catch {
    return null;
  }
}

function claudeJsonlPathForSession(sessionId, cwd) {
  const resolved = path.resolve(String(cwd || ""));
  const projectName = resolved.replace(/[^A-Za-z0-9-]/g, "-");
  return path.join(os.homedir(), ".claude", "projects", projectName, `${sessionId}.jsonl`);
}

async function processFileDescriptors(pid) {
  const value = Number(pid || 0);
  if (!Number.isFinite(value) || value <= 0) return [];
  const fdDir = `/proc/${value}/fd`;
  try {
    const entries = await fs.promises.readdir(fdDir);
    const targets = await Promise.all(entries.map(async (entry) => {
      try {
        return await fs.promises.readlink(path.join(fdDir, entry));
      } catch {
        return "";
      }
    }));
    return targets.filter(Boolean);
  } catch {
    return [];
  }
}

function codexEventFromJson(item, lineNumber) {
  if (!item || typeof item !== "object") return null;
  if (item.type !== "response_item") return null;
  const payload = item.payload;
  if (!payload || typeof payload !== "object" || payload.type !== "message") return null;
  if (payload.role === "user") {
    const text = joinTextBlocks(payload.content, "input_text");
    return text ? { kind: "user", text, time: eventTimeMs(item), id: `codex:${lineNumber}` } : null;
  }
  if (payload.role === "assistant" && payload.phase === "final_answer") {
    const text = joinTextBlocks(payload.content, "output_text");
    return text ? { kind: "assistant_final", text, time: eventTimeMs(item), id: `codex:${lineNumber}` } : null;
  }
  return null;
}

function claudeMessagesFromEvents(events) {
  const messages = [];
  const assistantParts = [];
  let assistantTime = 0;
  let assistantId = "";
  const flushAssistant = () => {
    const text = assistantParts.join("\n\n").trim();
    if (text) messages.push({ role: "agent", text, time: assistantTime, id: assistantId });
    assistantParts.length = 0;
    assistantTime = 0;
    assistantId = "";
  };
  for (const event of events) {
    if (isMeaningfulClaudeUserEvent(event)) {
      flushAssistant();
      const text = claudeUserText(event).trim();
      if (text) messages.push({ role: "user", text, time: eventTimeMs(event), id: String(event.uuid || "") });
      continue;
    }
    const text = claudeAssistantText(event);
    if (text) {
      assistantParts.push(text);
      assistantTime = eventTimeMs(event) || assistantTime;
      assistantId = String(event.uuid || assistantId);
    }
  }
  flushAssistant();
  return messages;
}

function latestClaudeAssistantText(events) {
  const parts = [];
  let seenAssistant = false;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (isMeaningfulClaudeUserEvent(event)) {
      if (seenAssistant) break;
      continue;
    }
    const text = claudeAssistantText(event);
    if (text) {
      seenAssistant = true;
      parts.push(text);
    }
  }
  return parts.reverse().join("\n\n").trim();
}

function latestClaudeUserIndex(events) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (isMeaningfulClaudeUserEvent(events[index])) return index;
  }
  return -1;
}

function latestClaudeAssistantIndex(events) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (claudeAssistantText(events[index])) return index;
  }
  return -1;
}

function isMeaningfulClaudeUserEvent(event) {
  if (!event || typeof event !== "object") return false;
  const message = event.message;
  const role = message && typeof message === "object" ? message.role : event.type;
  if (role !== "user") return false;
  if (event.isMeta === true || event.isCompactSummary === true || event.isSidechain === true) return false;
  const content = message && typeof message === "object" ? message.content : null;
  if (Array.isArray(content) && content.length && content.every((block) => block?.type === "tool_result")) return false;
  const text = normalizeText(claudeUserText(event));
  if (!text) return false;
  return ![
    "<command-name>",
    "<command-message>",
    "<command-args>",
    "<local-command-caveat>",
    "<local-command-stdout>",
    "<local-command-stderr>"
  ].some((prefix) => text.startsWith(prefix));
}

function claudeUserText(event) {
  const message = event?.message;
  const content = message && typeof message === "object" ? message.content : null;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((block) => {
    if (typeof block?.text === "string") return block.text;
    if (typeof block?.content === "string") return block.content;
    return "";
  }).filter(Boolean).join("\n");
}

function claudeAssistantText(event) {
  if (!event || typeof event !== "object" || event.isSidechain === true) return "";
  const message = event.message;
  const role = message && typeof message === "object" ? message.role : event.type;
  if (role !== "assistant" || !message || typeof message !== "object") return "";
  const content = message.content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content.map((block) => {
    return block?.type === "text" && typeof block.text === "string" ? block.text : "";
  }).filter(Boolean).join("\n\n").trim();
}

function joinTextBlocks(content, kind) {
  if (!Array.isArray(content)) return "";
  return content.map((block) => {
    return block?.type === kind && typeof block.text === "string" ? block.text : "";
  }).join("").trim();
}

function readJsonl(text) {
  const rows = [];
  for (const line of String(text || "").split("\n")) {
    if (!line.trim()) continue;
    try {
      const item = JSON.parse(line);
      if (item && typeof item === "object") rows.push(item);
    } catch {
      // Ignore partially-written or unrelated lines.
    }
  }
  return rows;
}

function latestEventIndex(events, kind) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].kind === kind) return index;
  }
  return -1;
}

function eventTimeMs(item) {
  const timestamp = item?.timestamp;
  if (typeof timestamp !== "string") return 0;
  const value = Date.parse(timestamp);
  return Number.isFinite(value) ? value : 0;
}

function stripTerminalCodes(value) {
  return String(value || "")
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/\x1b\][^\x07]*\x07/g, "")
    .replace(/\r/g, "");
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

function normalizeText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function transcriptPayload({
  messages = [],
  reply = "",
  completedReply = "",
  working = false,
  workingLabel = "",
  final = false
} = {}) {
  return {
    messages,
    reply,
    completedReply,
    working,
    workingLabel,
    final
  };
}

async function readTextFile(filePath) {
  try {
    return await fs.promises.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function fileExists(filePath) {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}
