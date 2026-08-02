// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { zValidator } from "@hono/zod-validator";
import { streamText as aiStreamText, stepCountIs } from "ai";
import { db } from "@ANCIENT/database/client";
import { Mode, MessageStatus } from "@ANCIENT/database/enums";
import type { Prisma } from "@ANCIENT/database";
import {
  type ChatStreamEvent,
  type MessagePart,
  toolCallArgsSchema,
  messagePartsSchema,
  submitSchema,
  type ChatModelSelection,
} from "@ANCIENT/shared";
import { createTools } from "../tools";
import { buildSystemPrompt } from "../system-prompt";
import { resolveChatModel } from "../lib/models";
import type { AuthenticatedEnv } from "../middleware/require-auth";

const MAX_RESPONSE_CHARS = Number.parseInt(process.env.ANCIENT_MAX_RESPONSE_CHARS ?? "200000", 10);
const CHAT_TIMEOUT_MS = Number.parseInt(process.env.ANCIENT_CHAT_TIMEOUT_MS ?? "60000", 10);
const MAX_TOOL_STEPS = Number.parseInt(process.env.ANCIENT_MAX_TOOL_STEPS ?? "50", 10);

function buildConversationHistory(
  messages: { role: "USER" | "ASSISTANT" | "ERROR"; content: string; status: MessageStatus }[],
) {
  return messages.flatMap((m) => {
    if (m.role === "ERROR") return [];
    if (m.role === "ASSISTANT" && m.content.length === 0) return [];
    return [{ role: m.role === "USER" ? ("user" as const) : ("assistant" as const), content: m.content }];
  });
}

function getResumableUserMessage(messages: any[]) {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "USER") return null;
  return last;
}

type StreamParams = {
  sessionId: string;
  userId: string;
  selection: ChatModelSelection;
  cwd: string | null;
  history: { role: "user" | "assistant"; content: string }[];
  mode: Mode;
  abortController: AbortController;
};

async function streamAIResponse(
  stream: Parameters<Parameters<typeof streamSSE>[1]>[0],
  params: StreamParams,
) {
  const { sessionId, userId, selection, cwd, history, mode, abortController } = params;
  const startTime = Date.now();
  const parts: MessagePart[] = [];
  const tools = cwd ? createTools(cwd, mode) : undefined;

  const resolved = await resolveChatModel(selection, userId);
  const model = resolved.model;
  const apiKey = resolved.apiKey;

  const persistInterruptedMessage = async () => {
    const fullText = parts.filter((p) => p.type === "text").map((p) => p.text).join("");
    if (fullText.length === 0 && parts.length === 0) return;
    const elapsedMs = Date.now() - startTime;
    const validatedParts: Prisma.InputJsonValue | undefined = parts.length > 0 ? messagePartsSchema.parse(parts) : undefined;
    const modelKind = selection.modelKind;
    const modelRef = selection.modelKind === "builtin" ? selection.modelId : selection.connectionId;

    await db.message.create({
      data: {
        sessionId,
        role: "ASSISTANT",
        status: MessageStatus.INTERRUPTED,
        modelKind,
        modelRef,
        content: fullText,
        parts: validatedParts,
        mode,
        duration: Math.round(elapsedMs / 1000),
      },
    });
  };

  // FIXED: Escape regex special chars before redacting
  const sanitizeError = (err: unknown): string => {
    let msg = err instanceof Error ? err.message : String(err);
    if (apiKey && typeof msg === "string") {
      const escaped = apiKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      msg = msg.replace(new RegExp(escaped, "g"), "[REDACTED]");
    }
    return msg;
  };

  try {
    const result = aiStreamText({
      model,
      system: buildSystemPrompt({ cwd, mode }),
      messages: history,
      tools,
      stopWhen: tools ? stepCountIs(MAX_TOOL_STEPS) : undefined,
      abortSignal: abortController.signal,
    });

    for await (const part of result.fullStream) {
      if (stream.aborted) break;

      if (part.type === "reasoning-delta") {
        const last = parts[parts.length - 1];
        if (last && last.type === "reasoning") { last.text += part.text; } else { parts.push({ type: "reasoning", text: part.text }); }
        const event: ChatStreamEvent = { type: "reasoning-delta", text: part.text };
        await stream.writeSSE({ event: "reasoning-delta", data: JSON.stringify(event) });
      }

      if (part.type === "text-delta") {
        const last = parts[parts.length - 1];
        if (last && last.type === "text") { last.text += part.text; } else { parts.push({ type: "text", text: part.text }); }
        const event: ChatStreamEvent = { type: "text-delta", text: part.text };
        await stream.writeSSE({ event: "text-delta", data: JSON.stringify(event) });
      }

      if (part.type === "tool-call") {
        const args = toolCallArgsSchema.parse(part.input);
        parts.push({ type: "tool-call", id: part.toolCallId, name: part.toolName, args });
        const event: ChatStreamEvent = { type: "tool-call", toolCallId: part.toolCallId, toolName: part.toolName, args };
        await stream.writeSSE({ event: "tool-call", data: JSON.stringify(event) });
      }

      if (part.type === "tool-result") {
        const resultStr = typeof part.output === "string" ? part.output : JSON.stringify(part.output);
        const tcPart = parts.find((p): p is Extract<MessagePart, { type: "tool-call" }> => p.type === "tool-call" && p.id === part.toolCallId);
        if (tcPart) tcPart.result = resultStr;
        const event: ChatStreamEvent = { type: "tool-result", toolCallId: part.toolCallId, result: resultStr };
        await stream.writeSSE({ event: "tool-result", data: JSON.stringify(event) });
      }

      if (part.type === "error") throw part.error;
    }

    if (stream.aborted || abortController.signal.aborted) {
      await persistInterruptedMessage();
      return;
    }

    let totalTextLength = parts.filter((p) => p.type === "text").reduce((sum, p) => sum + p.text.length, 0);
    if (totalTextLength > MAX_RESPONSE_CHARS) {
      let accumulated = 0;
      for (const p of parts) {
        if (p.type === "text") {
          if (accumulated + p.text.length > MAX_RESPONSE_CHARS) {
            const allowed = MAX_RESPONSE_CHARS - accumulated;
            p.text = p.text.slice(0, allowed) + "\n... (truncated)";
            break;
          }
          accumulated += p.text.length;
        }
      }
    }

    if (mode === "BUILD" && parts.every((p) => p.type !== "tool-call")) {
      parts.push({ type: "text", text: "\n⚠️ This model did not emit any tool calls in BUILD mode. It may not support tool calling reliably." });
    }

    const elapsedMs = Date.now() - startTime;
    const fullText = parts.filter((p) => p.type === "text").map((p) => p.text).join("");
    const validatedParts: Prisma.InputJsonValue | undefined = parts.length > 0 ? messagePartsSchema.parse(parts) : undefined;
    const modelKind = selection.modelKind;
    const modelRef = selection.modelKind === "builtin" ? selection.modelId : selection.connectionId;

    const assistantMessage = await db.message.create({
      data: {
        sessionId, role: "ASSISTANT", status: MessageStatus.COMPLETE,
        modelKind, modelRef, content: fullText, parts: validatedParts, mode,
        duration: Math.round(elapsedMs / 1000),
      },
    });

    const doneEvent: ChatStreamEvent = { type: "done", messageId: assistantMessage.id, durationMs: elapsedMs };
    await stream.writeSSE({ event: "done", data: JSON.stringify(doneEvent) });
  } catch (err) {
    if (abortController.signal.aborted) {
      await persistInterruptedMessage();
      return;
    }
    const message = sanitizeError(err);
    const modelKind = selection.modelKind;
    const modelRef = selection.modelKind === "builtin" ? selection.modelId : selection.connectionId;

    await db.message.create({
      data: { sessionId, role: "ERROR", status: MessageStatus.COMPLETE, modelKind, modelRef, content: message, mode },
    });

    const errorEvent: ChatStreamEvent = { type: "error", message };
    await stream.writeSSE({ event: "error", data: JSON.stringify(errorEvent) });
  }
}

const app = new Hono<AuthenticatedEnv>();

app.post("/:sessionId/resume", async (c) => {
  const sessionId = c.req.param("sessionId");
  const userId = c.get("userId");

  const session = await db.session.findUnique({
    where: { id: sessionId, userId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!session) return c.json({ error: "Session not found" }, 404);

  const lastUser = getResumableUserMessage(session.messages);
  if (!lastUser) return c.json({ error: "No pending user message" }, 409);

  const selection: ChatModelSelection = lastUser.modelKind === "builtin"
    ? { modelKind: "builtin", modelId: lastUser.modelRef }
    : { modelKind: "custom", connectionId: lastUser.modelRef };

  try { await resolveChatModel(selection, userId); } catch {
    return c.json({ error: "The model used in this session is no longer available" }, 409);
  }

  const history = buildConversationHistory(session.messages);
  const abortController = new AbortController();

  return streamSSE(
    c,
    async (stream) => {
      stream.onAbort(() => abortController.abort());
      await streamAIResponse(stream, { sessionId, userId, selection, cwd: session.cwd, history, mode: lastUser.mode, abortController });
    },
    async (err, stream) => {
      const message = err instanceof Error ? err.message : String(err);
      const errorEvent: ChatStreamEvent = { type: "error", message };
      await stream.writeSSE({ event: "error", data: JSON.stringify(errorEvent) });
    },
  );
});

app.post("/:sessionId", zValidator("json", submitSchema), async (c) => {
  const sessionId = c.req.param("sessionId");
  const userId = c.get("userId");

  const session = await db.session.findUnique({
    where: { id: sessionId, userId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!session) return c.json({ error: "Session not found" }, 404);

  const data = c.req.valid("json");
  const modelKind = data.model.modelKind;
  const modelRef = data.model.modelKind === "builtin" ? data.model.modelId : data.model.connectionId;

  await db.message.create({
    data: { sessionId, role: "USER", status: MessageStatus.COMPLETE, modelKind, modelRef, content: data.content, mode: data.mode },
  });

  const history = buildConversationHistory([
    ...session.messages,
    { role: "USER" as const, content: data.content, status: MessageStatus.COMPLETE },
  ]);

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), CHAT_TIMEOUT_MS);

  return streamSSE(
    c,
    async (stream) => {
      stream.onAbort(() => { clearTimeout(timeoutId); abortController.abort(); });
      await streamAIResponse(stream, { sessionId, userId, selection: data.model, cwd: session.cwd, history, mode: data.mode, abortController });
    },
    async (err, stream) => {
      clearTimeout(timeoutId);
      const message = err instanceof Error ? err.message : String(err);
      const errorEvent: ChatStreamEvent = { type: "error", message };
      await stream.writeSSE({ event: "error", data: JSON.stringify(errorEvent) });
    },
  );
});

export default app;