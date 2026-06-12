import assert from "node:assert/strict";
import test from "node:test";

import {
  chatMessagesFromOutput,
  renderSessionPage
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
