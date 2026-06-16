import assert from "node:assert/strict";
import test from "node:test";

import {
  chatMessagesFromOutput,
  renderSessionsPage,
  renderSessionPage,
  renderTranscriptMessages
} from "../src/views.js";

test("chatMessagesFromOutput hides agent metadata and merges continuous output", () => {
  const output = [
    "Model: gpt-5-codex",
    "Working directory: /share/dai-sys/zhaotianlang/tmuxfleet",
    "Approval policy: never",
    "Sandbox: danger-full-access",
    "",
    "System: You are Codex, a coding agent.",
    "I found the sessions page.",
    "",
    "The output cards are split too aggressively.",
    "This should be one visible output card."
  ].join("\n");

  assert.deepEqual(chatMessagesFromOutput(output), [
    {
      role: "agent",
      label: "Output",
      text: [
        "I found the sessions page.",
        "",
        "The output cards are split too aggressively.",
        "This should be one visible output card."
      ].join("\n")
    }
  ]);
});

test("chatMessagesFromOutput treats captured terminal text as output instead of guessed input", () => {
  const output = [
    "> npm run check",
    "node --check src/*.js test/*.js",
    "",
    "TAP version 13",
    "  ---",
    "  duration_ms: 2.2",
    "  ...",
    "# tests 2",
    "# pass 2"
  ].join("\n");

  assert.deepEqual(chatMessagesFromOutput(output), [
    {
      role: "agent",
      label: "Output",
      text: [
        "> npm run check",
        "node --check src/*.js test/*.js",
        "",
        "TAP version 13",
        "  duration_ms: 2.2",
        "# tests 2",
        "# pass 2"
      ].join("\n")
    }
  ]);
});

test("chatMessagesFromOutput hides standalone divider lines", () => {
  const output = [
    "First useful line",
    "--------",
    "────────────────────────",
    "====",
    "Second useful line"
  ].join("\n");

  assert.deepEqual(chatMessagesFromOutput(output), [
    {
      role: "agent",
      label: "Output",
      text: [
        "First useful line",
        "Second useful line"
      ].join("\n")
    }
  ]);
});

test("renderSessionsPage redirects to the session name returned by the create API", () => {
  const html = renderSessionsPage([
    { name: "local", status: "connected", sessions: [] }
  ]);

  assert.match(html, /const createdName = body\.session && body\.session\.name \? body\.session\.name : data\.name;/);
  assert.match(html, /encodeURIComponent\(createdName\)/);
});

test("renderSessionPage keeps raw output available outside the filtered chat log", () => {
  const html = renderSessionPage({
    node: { name: "local", url: "http://127.0.0.1:8091" },
    name: "agent",
    windows: [],
    selectedWindow: "",
    output: "Model: gpt-5-codex\nVisible answer",
    autoRecoverConfig: null
  });

  assert.match(html, /class="raw-output"/);
  assert.match(html, /查看原始输出/);
  assert.match(html, /Model: gpt-5-codex/);
});

test("renderSessionPage prefers structured transcript messages over raw output parsing", () => {
  const html = renderSessionPage({
    node: { name: "local", url: "http://127.0.0.1:8091" },
    name: "agent",
    windows: [],
    selectedWindow: "",
    output: "Model: gpt-5-codex\nraw fallback",
    transcript: {
      messages: [
        { role: "user", text: "please fix this" },
        { role: "agent", text: "fixed from transcript" }
      ]
    },
    autoRecoverConfig: null
  });

  assert.match(html, /<div class="chat-role">Input<\/div>/);
  assert.match(html, /please fix this/);
  assert.match(html, /fixed from transcript/);
  const chatLog = html.match(/<div id="chat-log"[\s\S]*?<\/div>/)?.[0] || "";
  assert.doesNotMatch(chatLog, /raw fallback/);
});

test("renderSessionPage safely embeds transcript messages in script JSON", () => {
  const html = renderSessionPage({
    node: { name: "local", url: "http://127.0.0.1:8091" },
    name: "agent",
    windows: [],
    selectedWindow: "",
    output: "",
    transcript: { messages: [{ role: "agent", text: "</script><script>alert(1)</script>" }] },
    autoRecoverConfig: null
  });

  assert.doesNotMatch(html, /const initialTranscriptMessages = .*<\/script><script>/);
  assert.match(html, /\\u003c\/script\\u003e/);
});

test("renderSessionPage blocks sends while the agent transcript is working", () => {
  const html = renderSessionPage({
    node: { name: "local", url: "http://127.0.0.1:8091" },
    name: "agent",
    windows: [],
    selectedWindow: "",
    output: "",
    transcript: { working: true, messages: [{ role: "user", text: "still running" }] },
    autoRecoverConfig: null
  });

  assert.match(html, /let agentWorking = true;/);
  assert.match(html, /sendButton\.disabled = sending \|\| agentWorking;/);
  assert.match(html, /if \(agentWorking\)/);
});

test("renderTranscriptMessages labels auto-recover events distinctly from user input", () => {
  const messages = [
    { role: "user", text: "fix the bug", time: 1000 },
    { role: "agent", text: "Working on it...", time: 2000 }
  ];
  const events = [
    { type: "auto-recover", message: "go on", reason: "pattern match", time: 3000 },
    { type: "smart-recover", message: "go on", reason: "LLM approved", time: 4000 }
  ];
  const html = renderTranscriptMessages(messages, "", events);

  assert.match(html, /class="chat-message user"/);
  assert.match(html, /class="chat-message agent"/);
  assert.match(html, /class="chat-message system"/);
  assert.match(html, /Auto Recover/);
  assert.match(html, /Smart Recover/);
  assert.match(html, /pattern match/);
  assert.match(html, /LLM approved/);
});

test("renderSessionPage embeds auto-recover events for client-side rendering", () => {
  const html = renderSessionPage({
    node: { name: "local", url: "http://127.0.0.1:8091" },
    name: "test-session",
    windows: [],
    selectedWindow: "",
    output: "",
    transcript: { messages: [] },
    autoRecoverConfig: null,
    autoRecoverEvents: [
      { type: "auto-recover", message: "go on", reason: "pattern match", time: 5000 }
    ]
  });

  assert.match(html, /initialAutoRecoverEvents/);
  assert.match(html, /auto-recover/);
});
