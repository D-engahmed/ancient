// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Model chat adapter classification tests (engine). The classifier duck-types
// provider errors by shape because the AI SDK re-exports a different APICallError
// class than streamText throws; these tests lock the status mapping and the
// secret-scrubbing guarantee (durable envelopes must never carry the key).

import { describe, expect, it } from "bun:test";
import { envelopeFromModelError } from "./model";

describe("envelopeFromModelError", () => {
  it("maps 429 transient -> PROVIDER_RATE_LIMITED, retryable as-is", () => {
    const envelope = envelopeFromModelError({ statusCode: 429, message: "rate limit" });
    expect(envelope).toMatchObject({ code: "PROVIDER_RATE_LIMITED", domain: "provider", transient: true, retryableAsIs: true });
  });

  it("maps 401/403 -> PROVIDER_AUTH_FAILED (terminal, never retried)", () => {
    const envelope = envelopeFromModelError({ statusCode: 401, message: "Incorrect API key provided: sk-proj-****" });
    expect(envelope).toMatchObject({ code: "PROVIDER_AUTH_FAILED", domain: "provider", transient: false });
  });

  it("maps 5xx -> PROVIDER_UNAVAILABLE (transient)", () => {
    const envelope = envelopeFromModelError({ statusCode: 503, message: "overloaded" });
    expect(envelope).toMatchObject({ code: "PROVIDER_UNAVAILABLE", domain: "provider", transient: true });
  });

  it("maps 4xx (other) -> PROVIDER_UNAVAILABLE terminal", () => {
    const envelope = envelopeFromModelError({ statusCode: 404, message: "model not found" });
    expect(envelope).toMatchObject({ code: "PROVIDER_UNAVAILABLE", domain: "provider", transient: false });
  });

  it("unwraps the SDK RetryError wrapper before classifying", () => {
    const envelope = envelopeFromModelError({ lastError: { statusCode: 429 }, message: "Failed after 3 attempts" });
    expect(envelope?.code).toBe("PROVIDER_RATE_LIMITED");
  });

  it("returns undefined for non-provider errors (fall through to STRATEGY_UNRECOVERABLE)", () => {
    expect(envelopeFromModelError(new Error("boom"))).toBeUndefined();
    expect(envelopeFromModelError({ something: "else" })).toBeUndefined();
    expect(envelopeFromModelError(undefined)).toBeUndefined();
  });

  it("never embeds the raw provider message (the key is not persisted in the envelope)", () => {
    const envelope = envelopeFromModelError({ statusCode: 401, message: "Incorrect API key: sk-ant-api03-0123456789abcdef" });
    expect(envelope?.message).not.toContain("sk-ant");
    expect(envelope?.message).toContain("credentials");
  });
});