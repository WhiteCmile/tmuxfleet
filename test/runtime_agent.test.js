import assert from "node:assert/strict";
import test from "node:test";

import { inferAgentProcessFromRows } from "../src/runtime.js";

test("inferAgentProcessFromRows detects a direct agent command", () => {
  assert.deepEqual(inferAgentProcessFromRows("codex", 123, []), {
    cli: "codex",
    pid: 123
  });
});

test("inferAgentProcessFromRows prefers a matching child pid for a direct agent command", () => {
  const rows = [
    { pid: 20, ppid: 10, command: "bash" },
    { pid: 30, ppid: 20, command: "codex" }
  ];

  assert.deepEqual(inferAgentProcessFromRows("codex", 10, rows), {
    cli: "codex",
    pid: 30
  });
});

test("inferAgentProcessFromRows walks pane child processes for an agent CLI", () => {
  const rows = [
    { pid: 20, ppid: 10, command: "bash" },
    { pid: 30, ppid: 20, command: "node" },
    { pid: 40, ppid: 30, command: "claude" }
  ];

  assert.deepEqual(inferAgentProcessFromRows("bash", 10, rows), {
    cli: "claude",
    pid: 40
  });
});

test("inferAgentProcessFromRows returns unknown when no supported agent is present", () => {
  const rows = [{ pid: 20, ppid: 10, command: "vim" }];

  assert.deepEqual(inferAgentProcessFromRows("bash", 10, rows), {
    cli: "",
    pid: 0
  });
});
