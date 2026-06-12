import assert from "node:assert/strict";
import test from "node:test";

import {
  parseClaudeJsonlTranscript,
  parseCodexJsonlTranscript,
  parseTranscriptFromOutput
} from "../src/transcript.js";

test("parseCodexJsonlTranscript returns structured user and final assistant messages", () => {
  const jsonl = [
    JSON.stringify({
      type: "response_item",
      timestamp: "2026-06-12T01:00:00.000Z",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "fix the frontend output" }]
      }
    }),
    JSON.stringify({
      type: "response_item",
      timestamp: "2026-06-12T01:00:05.000Z",
      payload: {
        type: "message",
        role: "assistant",
        phase: "final_answer",
        content: [{ type: "output_text", text: "I changed the parser." }]
      }
    })
  ].join("\n");

  assert.deepEqual(parseCodexJsonlTranscript(jsonl).messages, [
    {
      role: "user",
      text: "fix the frontend output",
      time: 1781226000000,
      id: "codex:1"
    },
    {
      role: "agent",
      text: "I changed the parser.",
      time: 1781226005000,
      id: "codex:2"
    }
  ]);
  assert.equal(parseCodexJsonlTranscript(jsonl).working, false);
});

test("parseCodexJsonlTranscript reports working after a later user turn", () => {
  const jsonl = [
    JSON.stringify({
      type: "response_item",
      timestamp: "2026-06-12T01:00:00.000Z",
      payload: {
        type: "message",
        role: "assistant",
        phase: "final_answer",
        content: [{ type: "output_text", text: "Previous answer." }]
      }
    }),
    JSON.stringify({
      type: "response_item",
      timestamp: "2026-06-12T01:01:00.000Z",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "go on" }]
      }
    })
  ].join("\n");

  const state = parseCodexJsonlTranscript(jsonl);
  assert.equal(state.working, true);
  assert.equal(state.workingLabel, "Working");
});

test("parseClaudeJsonlTranscript ignores meta and tool-result user events", () => {
  const jsonl = [
    JSON.stringify({
      uuid: "meta-1",
      timestamp: "2026-06-12T01:00:00.000Z",
      isMeta: true,
      message: { role: "user", content: "synthetic setup" }
    }),
    JSON.stringify({
      uuid: "tool-1",
      timestamp: "2026-06-12T01:00:01.000Z",
      message: {
        role: "user",
        content: [{ type: "tool_result", content: "tool output" }]
      }
    }),
    JSON.stringify({
      uuid: "user-1",
      timestamp: "2026-06-12T01:00:02.000Z",
      message: { role: "user", content: "please summarize" }
    }),
    JSON.stringify({
      uuid: "assistant-1",
      timestamp: "2026-06-12T01:00:03.000Z",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Here is the summary." }]
      }
    })
  ].join("\n");

  assert.deepEqual(parseClaudeJsonlTranscript(jsonl).messages, [
    {
      role: "user",
      text: "please summarize",
      time: 1781226002000,
      id: "user-1"
    },
    {
      role: "agent",
      text: "Here is the summary.",
      time: 1781226003000,
      id: "assistant-1"
    }
  ]);
});

test("parseTranscriptFromOutput falls back to cleaned terminal output", () => {
  const state = parseTranscriptFromOutput([
    "Model: gpt-5-codex",
    "Useful visible output",
    "--------",
    "Still useful"
  ].join("\n"));

  assert.deepEqual(state.messages, [
    { role: "agent", text: "Useful visible output\nStill useful", time: 0, id: "" }
  ]);
});
