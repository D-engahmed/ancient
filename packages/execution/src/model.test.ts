// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Model chat adapter tests (engine). The classifier duck-types provider errors
// by shape because the AI SDK re-exports a different APICallError class than
// streamText throws; these tests lock the status mapping, the secret-scrubbing
// guarantee (durable envelopes must never carry the key), and the structured
// history mapping (ASSUMPTION-026 — prior turns replay as native tool parts).

import { describe, expect, it } from "bun:test";
import type { TurnMessage } from "@ANCIENT/strategies";
import { envelopeFromModelError, historyToModelMessages } from "./model";
import type { ModelMessage } from "ai";

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

describe("historyToModelMessages", () => {
  const history: TurnMessage[] = [
    { role: "user", text: "task" },
    { role: "assistant", text: "", toolCalls: [{ id: "c1", name: "readFile", args: { path: "x.md" } }] },
    { role: "tool", toolCallId: "c1", toolName: "readFile", text: "file content" },
  ];

  it("maps a plain user turn to a text-only user message", () => {
    const messages = historyToModelMessages([history[0]!]);
    expect(messages).toEqual([{ role: "user", content: [{ type: "text", text: "task" }] }]);
  });

  it("replays an assistant tool-call turn as tool-call parts, keeping the call ids", () => {
    const messages = historyToModelMessages(history);
    const assistant = messages[1] as Extract<ModelMessage, { role: "assistant" }>;
    expect(assistant.role).toBe("assistant");
    expect(assistant.content).toEqual([
      { type: "tool-call", toolCallId: "c1", toolName: "readFile", input: { path: "x.md" } },
    ]);
  });

  it("places text before the tool-call parts when the assistant also wrote prose", () => {
    const messages = historyToModelMessages([
      { role: "assistant", text: "reading…", toolCalls: [{ id: "c9", name: "grep", args: { pattern: "x" } }] },
    ]);
    const assistant = messages[0] as Extract<ModelMessage, { role: "assistant" }>;
    expect(assistant.content).toEqual([
      { type: "text", text: "reading…" },
      { type: "tool-call", toolCallId: "c9", toolName: "grep", input: { pattern: "x" } },
    ]);
  });

  it("normalizes absent args to an empty input object", () => {
    const messages = historyToModelMessages([
      { role: "assistant", text: "", toolCalls: [{ id: "cA", name: "listDirectory", args: undefined }] },
    ]);
    const assistant = messages[0] as Extract<ModelMessage, { role: "assistant" }>;
    expect((assistant.content[0] as { input: unknown }).input).toEqual({});
  });

  it("attributes each tool result to the call id it answered", () => {
    const messages = historyToModelMessages(history);
    const tool = messages[2] as Extract<ModelMessage, { role: "tool" }>;
    expect(tool.role).toBe("tool");
    expect(tool.content).toEqual([
      { type: "tool-result", toolCallId: "c1", toolName: "readFile", output: { type: "text", value: "file content" } },
    ]);
  });

  it("round-trips a full loop: user -> assistant-with-calls -> tool, ids pair exactly", () => {
    const messages = historyToModelMessages(history);
    const assistant = messages[1] as Extract<ModelMessage, { role: "assistant" }>;
    const tool = messages[2] as Extract<ModelMessage, { role: "tool" }>;
    const issued = (assistant.content as { toolCallId: string }[]).map((p) => p.toolCallId);
    const answered = (tool.content as { toolCallId: string }[]).map((p) => p.toolCallId);
    expect(answered).toEqual(issued);
    expect(answered).toEqual(["c1"]);
  });

  it("keeps text-only assistant turns as plain text parts", () => {
    const messages = historyToModelMessages([{ role: "assistant", text: "all done" }]);
    expect(messages).toEqual([{ role: "assistant", content: [{ type: "text", text: "all done" }] }]);
  });
});