// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.

// Gateway Error Mapper unit tests (docs/02 Sub-layer F + docs/20 §6).

import { describe, expect, test } from "bun:test";
import { makeError } from "@ANCIENT/contracts";
import { errorJson, genericMessageFor, statusForCode, gatewayError, clientErrorFrom } from "./error-mapper";
import { RateLimitCooldownError } from "./rate-limit-breaker";
import { ProviderConnectionValidationError } from "./provider-connection-validation";

describe("genericMessageFor", () => {
  test("maps every ErrorCode to a non-empty generic message", () => {
    const codes: string[] = [
      "EDGE_RATE_LIMITED",
      "EDGE_OVERLOADED",
      "EDGE_PAYLOAD_TOO_LARGE",
      "EDGE_ABUSE_SIGNATURE",
      "AUTH_UNAUTHENTICATED",
      "AUTH_TOKEN_EXPIRED",
      "AUTH_INSUFFICIENT_SCOPE",
      "POLICY_DENIED",
      "POLICY_APPROVAL_REQUIRED",
      "CONTEXT_BUDGET_EXCEEDED",
      "CONTEXT_SOURCE_UNAVAILABLE",
      "MODEL_TIMEOUT",
      "MODEL_INVALID_OUTPUT",
      "MODEL_CONTEXT_OVERFLOW",
      "MODEL_CONTENT_FILTERED",
      "PROVIDER_RATE_LIMITED",
      "PROVIDER_UNAVAILABLE",
      "PROVIDER_AUTH_FAILED",
      "PROVIDER_UNSUPPORTED_CAPABILITY",
      "CAPABILITY_TIMEOUT",
      "CAPABILITY_INVALID_ARGUMENT",
      "CAPABILITY_EXECUTION_FAILED",
      "CAPABILITY_SANDBOX_LOST",
      "CAPABILITY_PARTIAL_EFFECT",
      "STRATEGY_BUDGET_EXCEEDED",
      "STRATEGY_STALLED",
      "STRATEGY_UNRECOVERABLE",
      "INFRA_STORAGE_UNAVAILABLE",
      "INFRA_EVENT_LOG_WRITE_FAILED",
      "INFRA_SECRETS_UNAVAILABLE",
      "CONFLICT_VERSION_MISMATCH",
      "CONFLICT_DUPLICATE_IDEMPOTENCY_KEY",
      "SYSTEM_UNKNOWN",
    ];
    for (const code of codes) {
      expect(genericMessageFor(code as never)).toBeTruthy();
    }
  });

  test("unknown code falls back to SYSTEM_UNKNOWN — never an ad-hoc message", () => {
    expect(genericMessageFor("NOT_A_CODE" as never)).toBe(
      "Something went wrong on our side. Please retry or check the trace id.",
    );
  });
});

describe("statusForCode", () => {
  test("maps gateway/AUTH/rate-limit families to the edge HTTP conventions", () => {
    expect(statusForCode("EDGE_RATE_LIMITED")).toBe(429);
    expect(statusForCode("PROVIDER_RATE_LIMITED")).toBe(429);
    expect(statusForCode("AUTH_UNAUTHENTICATED")).toBe(401);
    expect(statusForCode("AUTH_TOKEN_EXPIRED")).toBe(401);
    expect(statusForCode("POLICY_DENIED")).toBe(403);
    expect(statusForCode("CONFLICT_VERSION_MISMATCH")).toBe(409);
    expect(statusForCode("PROVIDER_UNAVAILABLE")).toBe(503);
    expect(statusForCode("CAPABILITY_TIMEOUT")).toBe(504);
  });
});

describe("clientErrorFrom", () => {
  test("envelope → client-safe projection: clientMessage priority, own traceId kept", () => {
    const envelope = makeError({
      code: "PROVIDER_RATE_LIMITED",
      domain: "provider",
      message: "openrouter z-ai/glm-5.2:free rate-limited (HTTP 429) upstream",
      clientMessage: "The model provider is rate-limiting requests. Wait and retry.",
      transient: true,
      traceId: "env-trace",
    });
    const { response, status } = clientErrorFrom(envelope, "http-trace");
    expect(response.message).toBe("The model provider is rate-limiting requests. Wait and retry.");
    expect(response.code).toBe("PROVIDER_RATE_LIMITED");
    expect(response.retryable).toBe(true);
    expect(response.traceId).toBe("env-trace");
    expect(status).toBe(429);
  });

  test("envelope without clientMessage falls back to the internal message", () => {
    const envelope = makeError({
      code: "CAPABILITY_EXECUTION_FAILED",
      domain: "capability",
      message: "shell command exited 1: rm -rf /tmp/build",
    });
    const { response } = clientErrorFrom(envelope, "t");
    expect(response.message).toBe("shell command exited 1: rm -rf /tmp/build");
  });

  test("RateLimitCooldownError → EDGE_RATE_LIMITED 429 with retryAfterMs", () => {
    const err = new RateLimitCooldownError("openrouter:glm-5.2:free", 42);
    const { response, status } = clientErrorFrom(err, "t");
    expect(response.code).toBe("EDGE_RATE_LIMITED");
    expect(response.retryable).toBe(true);
    expect(response.retryAfterMs).toBe(42_000);
    expect(response.traceId).toBe("t");
    expect(response.message).toContain("rate-limited recently");
    expect(status).toBe(429);
  });

  test("ProviderConnectionValidationError → PROVIDER_AUTH_FAILED 422", () => {
    const err = new ProviderConnectionValidationError("Unsupported provider protocol");
    const { response, status } = clientErrorFrom(err, "t");
    expect(response.code).toBe("PROVIDER_AUTH_FAILED");
    expect(response.message).toBe("Unsupported provider protocol");
    expect(status).toBe(422);
  });

  test("plain Error → SYSTEM_UNKNOWN via the generic message (nothing leaked)", () => {
    const { response, status } = clientErrorFrom(new Error("postgres: password=secret"), "t");
    expect(response.code).toBe("SYSTEM_UNKNOWN");
    expect(response.message).toBe("Something went wrong on our side. Please retry or check the trace id.");
    expect(response.message).not.toContain("secret");
    expect(status).toBe(500);
  });

  test("gatewayError builds a guard response with the traceId attached", () => {
    const body = gatewayError("Execution not found", 404, "trace-9");
    expect(body).toEqual({
      error: {
        code: "SYSTEM_UNKNOWN",
        message: "Execution not found",
        retryable: false,
        traceId: "trace-9",
      },
    });
  });
});

describe("errorJson", () => {
  test("writes the wire shape and stamps X-Trace-Id", async () => {
    const ctx = makeCtx("trace-abc");
    const res = errorJson(ctx.c as never, new Error("boom"), 500);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string; message: string; traceId: string } };
    expect(body.error.code).toBe("SYSTEM_UNKNOWN");
    expect(body.error.traceId).toBe("trace-abc");
    expect(ctx.headers).toHaveProperty("X-Trace-Id", "trace-abc");
  });
});

// Minimal Hono-context stand-in for errorJson (kept out of the production
// code path; Hono itself is exercised by the app-level tests).
function makeCtx(traceId: string) {
  const headers: Record<string, string> = {};
  return {
    headers,
    c: {
      get: () => traceId,
      header: (name: string, value: string) => {
        headers[name] = value;
      },
      json: (body: unknown, status: number) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json", ...headers },
        }),
    },
  };
}