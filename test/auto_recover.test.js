import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTO_RECOVER_COOLDOWN_MS,
  SMART_RECOVER_STALE_MS,
  autoRecoverFingerprint,
  looksRecoverableAgentError,
  markSmartRecoverReviewed,
  outputFingerprint,
  shouldSendAutoRecover,
  updateSmartRecoverObservation
} from "../src/auto_recover.js";

test("detects Claude Code interactive connection failures", () => {
  const output = `
> reply with ok
  Unable to connect to API (ConnectionRefused)
  Retrying in 40s - attempt 7/10
`;

  assert.equal(looksRecoverableAgentError(output), true);
  assert.notEqual(autoRecoverFingerprint(output), "");
});

test("detects Claude Code stream-json retry events for connection failures", () => {
  const output = [
    '{"type":"system","subtype":"init","session_id":"example"}',
    '{"type":"system","subtype":"api_retry","attempt":1,"max_retries":10,"retry_delay_ms":534,"error_status":null,"error":"unknown","session_id":"example"}'
  ].join("\n");

  assert.equal(looksRecoverableAgentError(output), true);
  assert.notEqual(autoRecoverFingerprint(output), "");
});

test("detects common Codex and socket network failures", () => {
  const samples = [
    "API Error: Connection error",
    "API Error: The socket connection was closed unexpectedly.",
    "error sending request",
    "fetch failed",
    "socket hang up",
    "ECONNRESET",
    "Socket lost connection"
  ];

  for (const sample of samples) {
    assert.equal(looksRecoverableAgentError(sample), true, sample);
  }
});

test("does not match ordinary terminal output", () => {
  const output = `
Running tests...
All checks passed.
Waiting for user input.
`;

  assert.equal(looksRecoverableAgentError(output), false);
  assert.equal(autoRecoverFingerprint(output), "");
});

test("sends on first matching error", () => {
  const decision = shouldSendAutoRecover({
    output: "Unable to connect to API (ConnectionRefused)",
    previous: undefined,
    now: 1000
  });

  assert.deepEqual(decision, {
    send: true,
    fingerprint: autoRecoverFingerprint("Unable to connect to API (ConnectionRefused)"),
    reason: "matched"
  });
});

test("does not resend the same error fingerprint", () => {
  const output = "Unable to connect to API (ConnectionRefused)";
  const fingerprint = autoRecoverFingerprint(output);
  const decision = shouldSendAutoRecover({
    output,
    previous: { fingerprint, sentAt: 1000 },
    now: 1000 + AUTO_RECOVER_COOLDOWN_MS + 1
  });

  assert.deepEqual(decision, {
    send: false,
    fingerprint,
    reason: "duplicate"
  });
});

test("holds different errors during cooldown", () => {
  const decision = shouldSendAutoRecover({
    output: "ECONNRESET",
    previous: {
      fingerprint: autoRecoverFingerprint("Unable to connect to API (ConnectionRefused)"),
      sentAt: 1000
    },
    now: 1000 + AUTO_RECOVER_COOLDOWN_MS - 1
  });

  assert.deepEqual(decision, {
    send: false,
    fingerprint: autoRecoverFingerprint("ECONNRESET"),
    reason: "cooldown"
  });
});

test("allows different errors after cooldown", () => {
  const decision = shouldSendAutoRecover({
    output: "ECONNRESET",
    previous: {
      fingerprint: autoRecoverFingerprint("Unable to connect to API (ConnectionRefused)"),
      sentAt: 1000
    },
    now: 1000 + AUTO_RECOVER_COOLDOWN_MS + 1
  });

  assert.deepEqual(decision, {
    send: true,
    fingerprint: autoRecoverFingerprint("ECONNRESET"),
    reason: "matched"
  });
});

test("does not request smart review before output is stale", () => {
  const output = "Claude is thinking...\n".repeat(10);
  const first = updateSmartRecoverObservation({
    output,
    previous: undefined,
    now: 1000,
    staleMs: SMART_RECOVER_STALE_MS
  });
  const second = updateSmartRecoverObservation({
    output,
    previous: first.observation,
    now: 1000 + SMART_RECOVER_STALE_MS - 1,
    staleMs: SMART_RECOVER_STALE_MS
  });

  assert.equal(second.review, false);
  assert.equal(second.reason, "not_stale");
});

test("requests smart review after unchanged output is stale", () => {
  const output = "Claude is thinking...\n".repeat(10);
  const first = updateSmartRecoverObservation({
    output,
    previous: undefined,
    now: 1000,
    staleMs: SMART_RECOVER_STALE_MS
  });
  const second = updateSmartRecoverObservation({
    output,
    previous: first.observation,
    now: 1000 + SMART_RECOVER_STALE_MS,
    staleMs: SMART_RECOVER_STALE_MS
  });

  assert.equal(second.review, true);
  assert.equal(second.reason, "stale");
  assert.equal(second.fingerprint, outputFingerprint(output));
});

test("does not request smart review twice for the same stale output", () => {
  const output = "Claude is thinking...\n".repeat(10);
  const fingerprint = outputFingerprint(output);
  const previous = markSmartRecoverReviewed({
    outputFingerprint: fingerprint,
    outputFirstSeenAt: 1000
  }, fingerprint, 1000 + SMART_RECOVER_STALE_MS);
  const decision = updateSmartRecoverObservation({
    output,
    previous,
    now: 1000 + SMART_RECOVER_STALE_MS * 2,
    staleMs: SMART_RECOVER_STALE_MS
  });

  assert.equal(decision.review, false);
  assert.equal(decision.reason, "already_reviewed");
});
