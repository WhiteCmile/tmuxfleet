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

test("parseCodexJsonlTranscript includes visible commentary", () => {
  const jsonl = [
    JSON.stringify({
      type: "response_item",
      timestamp: "2026-06-12T01:00:00.000Z",
      payload: {
        type: "message",
        role: "assistant",
        phase: "commentary",
        content: [{ type: "output_text", text: "I am checking the parser now." }]
      }
    })
  ].join("\n");

  assert.deepEqual(parseCodexJsonlTranscript(jsonl).messages, [
    {
      role: "agent",
      text: "I am checking the parser now.",
      time: 1781226000000,
      id: "codex:1"
    }
  ]);
});

test("parseCodexJsonlTranscript renders request_user_input choices and unblocks input", () => {
  const jsonl = [
    JSON.stringify({
      type: "response_item",
      timestamp: "2026-06-12T01:00:00.000Z",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "please choose an approach" }]
      }
    }),
    JSON.stringify({
      type: "response_item",
      timestamp: "2026-06-12T01:00:01.000Z",
      payload: {
        type: "function_call",
        name: "request_user_input",
        arguments: JSON.stringify({
          questions: [{
            question: "Pick the implementation mode.",
            options: [
              { label: "Minimal", description: "Smallest change" },
              { label: "Complete", description: "Broader behavior coverage" }
            ]
          }]
        })
      }
    })
  ].join("\n");

  const state = parseCodexJsonlTranscript(jsonl);
  assert.equal(state.working, false);
  assert.deepEqual(state.messages, [
    {
      role: "user",
      text: "please choose an approach",
      time: 1781226000000,
      id: "codex:1"
    },
    {
      role: "agent",
      text: "Pick the implementation mode.\n1. Minimal - Smallest change\n2. Complete - Broader behavior coverage",
      time: 1781226001000,
      id: "codex:2"
    }
  ]);
});

test("parseCodexJsonlTranscript ignores synthetic sub-agent user prompts when event user messages exist", () => {
  const jsonl = [
    JSON.stringify({
      type: "event_msg",
      timestamp: "2026-06-12T01:00:00.000Z",
      payload: {
        type: "user_message",
        message: "please inspect the code"
      }
    }),
    JSON.stringify({
      type: "response_item",
      timestamp: "2026-06-12T01:00:00.100Z",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "You are a sub-agent. Analyze src/transcript.js and report findings." }]
      }
    }),
    JSON.stringify({
      type: "response_item",
      timestamp: "2026-06-12T01:00:01.000Z",
      payload: {
        type: "message",
        role: "assistant",
        phase: "final_answer",
        content: [{ type: "output_text", text: "I inspected the parser." }]
      }
    })
  ].join("\n");

  assert.deepEqual(parseCodexJsonlTranscript(jsonl).messages, [
    {
      role: "user",
      text: "please inspect the code",
      time: 1781226000000,
      id: "codex:1"
    },
    {
      role: "agent",
      text: "I inspected the parser.",
      time: 1781226001000,
      id: "codex:3"
    }
  ]);
});

test("parseCodexJsonlTranscript exposes failed tool output as an error message", () => {
  const jsonl = [
    JSON.stringify({
      type: "response_item",
      timestamp: "2026-06-12T01:00:00.000Z",
      payload: {
        type: "function_call_output",
        output: [
          "Chunk ID: abc",
          "Wall time: 1.2 seconds",
          "Process exited with code 128",
          "Output:",
          "fatal: Authentication failed"
        ].join("\n")
      }
    })
  ].join("\n");

  assert.deepEqual(parseCodexJsonlTranscript(jsonl).messages, [
    {
      role: "error",
      text: "Process exited with code 128\nOutput:\nfatal: Authentication failed",
      time: 1781226000000,
      id: "codex:1"
    }
  ]);
});

test("parseCodexJsonlTranscript ignores Codex environment and AGENTS metadata user events", () => {
  const jsonl = [
    JSON.stringify({
      type: "response_item",
      timestamp: "2026-06-12T01:00:00.000Z",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "<environment_context>\n  <cwd>/repo</cwd>\n</environment_context>" }]
      }
    }),
    JSON.stringify({
      type: "response_item",
      timestamp: "2026-06-12T01:00:01.000Z",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "# AGENTS.md instructions for /repo\n\n<INSTRUCTIONS>\nUse npm run check.\n</INSTRUCTIONS>" }]
      }
    }),
    JSON.stringify({
      type: "response_item",
      timestamp: "2026-06-12T01:00:01.500Z",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "<turn_aborted>\nThe user interrupted the previous turn.\n</turn_aborted>" }]
      }
    }),
    JSON.stringify({
      type: "response_item",
      timestamp: "2026-06-12T01:00:01.750Z",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "/goal\n<goal>internal state</goal>" }]
      }
    }),
    JSON.stringify({
      type: "response_item",
      timestamp: "2026-06-12T01:00:02.000Z",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "please fix the parser" }]
      }
    })
  ].join("\n");

  assert.deepEqual(parseCodexJsonlTranscript(jsonl).messages, [
    {
      role: "user",
      text: "please fix the parser",
      time: 1781226002000,
      id: "codex:5"
    }
  ]);
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

test("parseClaudeJsonlTranscript renders AskUserQuestion choices", () => {
  const jsonl = [
    JSON.stringify({
      uuid: "user-1",
      timestamp: "2026-06-12T01:00:00.000Z",
      message: { role: "user", content: "configure the bridge" }
    }),
    JSON.stringify({
      uuid: "assistant-1",
      timestamp: "2026-06-12T01:00:01.000Z",
      message: {
        role: "assistant",
        content: [{
          type: "tool_use",
          name: "AskUserQuestion",
          input: {
            questions: [{
              question: "Which platform should I configure?",
              options: [
                { label: "Feishu", description: "Use Lark/Feishu" },
                { label: "Slack", description: "Use Slack" }
              ]
            }]
          }
        }]
      }
    })
  ].join("\n");

  const state = parseClaudeJsonlTranscript(jsonl);
  assert.equal(state.working, false);
  assert.deepEqual(state.messages, [
    {
      role: "user",
      text: "configure the bridge",
      time: 1781226000000,
      id: "user-1"
    },
    {
      role: "agent",
      text: "Which platform should I configure?\n1. Feishu - Use Lark/Feishu\n2. Slack - Use Slack",
      time: 1781226001000,
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
