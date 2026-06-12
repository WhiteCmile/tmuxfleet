import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSessionName,
  inferAgentProcessFromRows,
  parseSessionListOutput,
  sendTargetForRows,
  selectTranscriptPaneFromRows
} from "../src/runtime.js";

test("assertSessionName rejects tmux target separator characters", () => {
  assert.throws(
    () => assertSessionName("agent.dev"),
    /letters, numbers, underscore, or dash/
  );
  assert.throws(
    () => assertSessionName("agent:dev"),
    /letters, numbers, underscore, or dash/
  );
});

test("parseSessionListOutput parses tmux sessions with a stable sentinel separator", () => {
  assert.deepEqual(parseSessionListOutput([
    "test|tmuxfleet|1|tmuxfleet|0|tmuxfleet|1781248687|tmuxfleet|1781248687",
    "paper-agent-dev|tmuxfleet|2|tmuxfleet|1|tmuxfleet|1781249000|tmuxfleet|1781248000"
  ].join("\n")), [
    {
      name: "test",
      windows: "1",
      attached: "0",
      activity: "1781248687",
      created: "1781248687"
    },
    {
      name: "paper-agent-dev",
      windows: "2",
      attached: "1",
      activity: "1781249000",
      created: "1781248000"
    }
  ]);
});

test("parseSessionListOutput ignores rows where tmux did not emit field separators", () => {
  assert.deepEqual(parseSessionListOutput("test1_1_0_1781248687_1781248687\n"), []);
});

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

test("selectTranscriptPaneFromRows prefers an agent pane over an active shell pane", () => {
  const panes = [
    { currentCommand: "bash", panePid: 10, active: true },
    { currentCommand: "node", panePid: 20, active: false }
  ];
  const rows = [
    { pid: 30, ppid: 20, command: "codex" }
  ];

  assert.deepEqual(selectTranscriptPaneFromRows(panes, rows), {
    pane: panes[1],
    agent: { cli: "codex", pid: 30 }
  });
});

test("selectTranscriptPaneFromRows falls back to the active pane without an agent", () => {
  const panes = [
    { currentCommand: "bash", panePid: 10, active: true },
    { currentCommand: "vim", panePid: 20, active: false }
  ];

  assert.deepEqual(selectTranscriptPaneFromRows(panes, []), {
    pane: panes[0],
    agent: { cli: "", pid: 0 }
  });
});

test("sendTargetForRows targets the agent pane instead of the active shell pane", () => {
  const panes = [
    { currentCommand: "bash", panePid: 10, paneIndex: 0, active: true },
    { currentCommand: "node", panePid: 20, paneIndex: 1, active: false }
  ];
  const rows = [
    { pid: 30, ppid: 20, command: "codex" }
  ];

  assert.equal(sendTargetForRows("agent", "0", panes, rows), "agent:0.1");
  assert.equal(sendTargetForRows("agent", "", panes, rows), "agent:.1");
});
