import crypto from "node:crypto";

export const AUTO_RECOVER_COOLDOWN_MS = 120000;
export const SMART_RECOVER_STALE_MS = 90000;
export const SMART_RECOVER_MIN_OUTPUT_CHARS = 80;

export const AUTO_RECOVER_ERROR_PATTERNS = [
  /\bAPI Error\b/i,
  /\bUnable to connect to API\b/i,
  /\b(?:network|connection)\s+(?:error|failed|failure|lost|reset|refused|timeout|timed out|closed|disconnected)\b/i,
  /\b(?:ConnectionRefused|ConnectionReset|ConnectionClosed|ConnectionTimeout)\b/i,
  /\bsocket\s+(?:error|failed|failure|lose|lost|reset|timeout|timed out|closed|disconnected|lose connection|lost connection)\b/i,
  /\b(?:error sending request|request failed|failed to fetch|fetch failed|socket hang up)\b/i,
  /\b(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN)\b/,
  /"subtype"\s*:\s*"api_retry"[\s\S]{0,500}"error_status"\s*:\s*null/i
];

export function looksRecoverableAgentError(output) {
  const tail = String(output || "").slice(-8000);
  return AUTO_RECOVER_ERROR_PATTERNS.some((pattern) => pattern.test(tail));
}

export function autoRecoverFingerprint(output) {
  const matchingLines = String(output || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => AUTO_RECOVER_ERROR_PATTERNS.some((pattern) => pattern.test(line)))
    .slice(-3);
  if (!matchingLines.length) return "";
  return crypto.createHash("sha1").update(matchingLines.join("\n")).digest("hex");
}

export function outputFingerprint(output) {
  const value = String(output || "").slice(-12000);
  if (!value.trim()) return "";
  return crypto.createHash("sha1").update(value).digest("hex");
}

export function shouldSendAutoRecover({ output, previous, now = Date.now(), cooldownMs = AUTO_RECOVER_COOLDOWN_MS }) {
  const fingerprint = autoRecoverFingerprint(output);
  if (!fingerprint || !looksRecoverableAgentError(output)) {
    return { send: false, fingerprint: "", reason: "no_match" };
  }
  if (previous && previous.fingerprint === fingerprint) {
    return { send: false, fingerprint, reason: "duplicate" };
  }
  if (previous && now - previous.sentAt < cooldownMs) {
    return { send: false, fingerprint, reason: "cooldown" };
  }
  return { send: true, fingerprint, reason: "matched" };
}

export function updateSmartRecoverObservation({
  output,
  previous,
  now = Date.now(),
  staleMs = SMART_RECOVER_STALE_MS,
  minOutputChars = SMART_RECOVER_MIN_OUTPUT_CHARS
}) {
  const fingerprint = outputFingerprint(output);
  if (!fingerprint || String(output || "").trim().length < minOutputChars) {
    return { review: false, reason: "too_short", observation: clearSmartObservation(previous) };
  }

  const firstSeenAt = previous && previous.outputFingerprint === fingerprint
    ? Number(previous.outputFirstSeenAt || now)
    : now;
  const reviewed = previous && previous.reviewedOutputFingerprint === fingerprint;
  const observation = {
    ...previous,
    outputFingerprint: fingerprint,
    outputFirstSeenAt: firstSeenAt
  };

  if (reviewed) {
    return { review: false, reason: "already_reviewed", observation };
  }
  if (now - firstSeenAt < staleMs) {
    return { review: false, reason: "not_stale", observation };
  }
  return { review: true, reason: "stale", fingerprint, observation };
}

export function markSmartRecoverReviewed(previous, fingerprint, now = Date.now()) {
  return {
    ...previous,
    reviewedOutputFingerprint: fingerprint,
    reviewedAt: now
  };
}

export function recentOutputForReview(output, maxChars = 6000) {
  return String(output || "").slice(-maxChars);
}

function clearSmartObservation(previous) {
  if (!previous) return previous;
  const next = { ...previous };
  delete next.outputFingerprint;
  delete next.outputFirstSeenAt;
  delete next.reviewedOutputFingerprint;
  delete next.reviewedAt;
  return next;
}
