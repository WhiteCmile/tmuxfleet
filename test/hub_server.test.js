import assert from "node:assert/strict";
import test from "node:test";

import { normalizeListedSession } from "../src/hub_server.js";

test("normalizeListedSession repairs tmux fields appended to a remote session name", () => {
  assert.deepEqual(normalizeListedSession({
    name: "test_1_0_1781250094_1781250094",
    windows: 0,
    attached: 0,
    activity: 0,
    created: 0
  }), {
    name: "test",
    windows: 1,
    attached: 0,
    activity: 1781250094,
    created: 1781250094,
    lastUpdated: "2026-06-12T07:41:34.000Z"
  });
});

test("normalizeListedSession preserves valid session names when metadata is already parsed", () => {
  assert.deepEqual(normalizeListedSession({
    name: "test_1_0_1781250094_1781250094",
    windows: 2,
    attached: 1,
    activity: 1781250100,
    created: 1781250000
  }), {
    name: "test_1_0_1781250094_1781250094",
    windows: 2,
    attached: 1,
    activity: 1781250100,
    created: 1781250000
  });
});
