// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. 
// file: packages/cli/src/lib/http-errors.ts

// The gateway error shape (docs/02 §F) is `{ error: ClientSafeError }` where
// ClientSafeError is the { code, message, retryable, retryAfterMs?, traceId }
// envelope — the same shape the execution stream carries. The CLI must read
// the envelope's `message`; the old flat `{ error: string }` responses still
// parse for backwards-compat with un-migrated routes, and `{ message }` is a
// final fallback.

type ErrorResponse = {
  json: () => Promise<unknown>;
  status: number;
  statusText: string;
};

function isEnvelopeBody(value: unknown): value is { code: unknown; message: unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    "message" in value
  );
}

export function errorMessageFrom(data: { error?: unknown; message?: unknown }): string {
  const e = data.error;
  if (isEnvelopeBody(e)) {
    const message = e.message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  if (typeof e === "string" && e.length > 0) return e;
  if (typeof data.message === "string" && data.message.length > 0) return data.message;
  return "";
}

export async function getErrorMessage(response: ErrorResponse) {
  try {
    const data = (await response.json()) as { error?: unknown; message?: unknown };
    const message = errorMessageFrom(data);
    if (message.length > 0) return message;
  } catch {
    // Ignore invalid error payloads and fall back to the status text below.
  }

  return response.statusText || `Request failed with status ${response.status}`;
};
