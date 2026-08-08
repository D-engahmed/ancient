// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.

const REDACTED_KEYS = new Set([
  "apikey", "api_key", "encryptedkey", "encrypted_key",
  "authorization", "token", "accesstoken", "refreshtoken",
  "password", "secret",
]);

const REDACTED = "[redacted]";

function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value as object)) return "[circular]";
  seen.add(value as object);
  if (Array.isArray(value)) return value.map((v) => redact(v, seen));
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = REDACTED_KEYS.has(key.toLowerCase()) ? REDACTED : redact(val, seen);
  }
  return out;
}

type LogContext = Record<string, unknown>;
type Level = "info" | "warn" | "error";

function emit(level: Level, scope: string, message: string, context?: LogContext) {
  const line = {
    ts: new Date().toISOString(),
    level,
    scope,
    message,
    ...(context ? { context: redact(context) } : {}),
  };
  const out = JSON.stringify(line);
  if (level === "error") console.error(out);
  else if (level === "warn") console.warn(out);
  else console.log(out);
}

export function createLogger(scope: string) {
  return {
    info: (message: string, context?: LogContext) => emit("info", scope, message, context),
    warn: (message: string, context?: LogContext) => emit("warn", scope, message, context),
    error: (message: string, context?: LogContext) => emit("error", scope, message, context),
  };
}