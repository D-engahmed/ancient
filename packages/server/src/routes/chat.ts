// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { streamText, stepCountIs, APICallError, RetryError, type ModelMessage } from "ai";
import { db } from "@ANCIENT/database/client";
import { Mode, MessageStatus } from "@ANCIENT/database/enums";
import type { Prisma } from "@ANCIENT/database";
import {
  type MessagePart,
  messagePartsSchema,
  submitSchema,
  type ChatModelSelection,
  createLogger,
} from "@ANCIENT/shared";

import { createTools } from "../tools";
import { buildSystemPrompt } from "../system-prompt";
import { resolveChatModel } from "../lib/models";
import type { AuthenticatedEnv } from "../middleware/require-auth";

const log = createLogger("chat");


const MAX_RESPONSE_CHARS = Number.parseInt(process.env.ANCIENT_MAX_RESPONSE_CHARS ?? "200000", 10);
const CHAT_TIMEOUT_MS = Number.parseInt(process.env.ANCIENT_CHAT_TIMEOUT_MS ?? "60000", 10);
const MAX_TOOL_STEPS = Number.parseInt(process.env.ANCIENT_MAX_TOOL_STEPS ?? "50", 10);

function toolCallParts(parts: MessagePart[]) {
  return parts.filter(
    (p): p is Extract<MessagePart, { type: "tool-call" }> => p.type === "tool-call",
  );
}

/**
 * Rebuilds the message array sent back to the model from DB rows.
 *
 * The previous version used only `content` (the flattened text), which
 * silently dropped every tool call and tool result — and dropped the whole
 * turn outright when an assistant message had no final text (exactly what
 * happens when a turn ends mid-exploration, e.g. hitting MAX_TOOL_STEPS or a
 * timeout). That's why "continue" looked like a full restart: the model was
 * handed a conversation with the entire middle removed.
 *
 * This version reconstructs real ModelMessage[] from `parts`: an assistant
 * message (text + tool-call parts) followed by a tool message (matching
 * tool-result parts), the shape most providers require for multi-step tool
 * conversations. A tool-call with no `result` (saved mid-flight by onAbort)
 * still gets a synthetic tool-result — most providers reject a request
 * where a tool-call has no matching tool-result in the next message, and
 * silently dropping it would just recreate the same "lost turn" bug for a
 * different reason.
 */
function buildConversationHistory(
  messages: {
    role: "USER" | "ASSISTANT" | "ERROR";
    content: string;
    parts?: unknown;
    status: MessageStatus;
  }[],
): ModelMessage[] {
  const result: ModelMessage[] = [];

  for (const m of messages) {
    if (m.role === "ERROR") continue;

    if (m.role === "USER") {
      result.push({ role: "user", content: m.content });
      continue;
    }

    // ASSISTANT
    const parsed = messagePartsSchema.safeParse(m.parts ?? []);
    const parts = parsed.success ? parsed.data : [];
    const toolCalls = toolCallParts(parts);

    // Genuinely nothing to represent this turn — safe to drop.
    if (m.content.length === 0 && toolCalls.length === 0) continue;

    const assistantContent: Array<
      | { type: "text"; text: string }
      | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
    > = [];

    if (m.content.length > 0) {
      assistantContent.push({ type: "text", text: m.content });
    }
    for (const tc of toolCalls) {
      assistantContent.push({ type: "tool-call", toolCallId: tc.id, toolName: tc.name, input: tc.args });
    }

    result.push({ role: "assistant", content: assistantContent });

    if (toolCalls.length > 0) {
      result.push({
        role: "tool",
        content: toolCalls.map((tc) => ({
          type: "tool-result" as const,
          toolCallId: tc.id,
          toolName: tc.name,
          output:
            typeof tc.result === "string"
              ? { type: "text" as const, value: tc.result }
              : { type: "error-text" as const, value: "Interrupted before this call finished." },
        })),
      });
    }
  }

  return result;
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
  history: ModelMessage[];
  mode: Mode;
  abortController: AbortController;
};

async function streamAIResponse(params: StreamParams): Promise<Response> {
  const { sessionId, userId, selection, cwd, history, mode, abortController } = params;
  const startTime = Date.now();
  const parts: MessagePart[] = [];
  const tools = cwd ? createTools(cwd, mode) : undefined;

  const resolved = await resolveChatModel(selection, userId);
  const model = resolved.model;
  const apiKey = resolved.apiKey;

  const sanitizeError = (err: unknown): string => {
    let msg: string;
    if (err instanceof Error) {
      msg = err.message;
    } else if (err && typeof err === "object") {
      const nested = (err as { error?: unknown }).error;
      const nestedMsg = nested && typeof nested === "object" ? (nested as { message?: unknown }).message : undefined;
      const directMsg = (err as { message?: unknown }).message;
      if (typeof nestedMsg === "string") {
        msg = nestedMsg;
      } else if (typeof directMsg === "string") {
        msg = directMsg;
      } else {
        try {
          msg = JSON.stringify(err);
        } catch {
          msg = String(err);
        }
      }
    } else {
      msg = String(err);
    }
    if (apiKey && typeof msg === "string") {
      const escaped = apiKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      msg = msg.replace(new RegExp(escaped, "g"), "[REDACTED]");
    }
    return msg;
  };

  const result = streamText({
    model,
    system: buildSystemPrompt({ cwd, mode }),
    messages: history,
    tools,
    stopWhen: tools ? stepCountIs(MAX_TOOL_STEPS) : undefined,
    abortSignal: abortController.signal,

    onChunk: ({ chunk }) => {
      if (chunk.type === "text-delta") {
        const last = parts[parts.length - 1];
        if (last?.type === "text") {
          last.text += chunk.text;
        } else {
          parts.push({ type: "text", text: chunk.text });
        }
      } else if (chunk.type === "reasoning-delta") {
        const last = parts[parts.length - 1];
        if (last?.type === "reasoning") {
          last.text += chunk.text;
        } else {
          parts.push({ type: "reasoning", text: chunk.text });
        }

      } else if (chunk.type === "tool-call") {
        parts.push({
          type: "tool-call",
          id: chunk.toolCallId,
          name: chunk.toolName,
          args: chunk.input as Record<string, unknown>,
        });
      } else if (chunk.type === "tool-result") {
        const tc = parts.find(
          (p): p is Extract<MessagePart, { type: "tool-call" }> =>
            p.type === "tool-call" && p.id === chunk.toolCallId,
        );
        if (tc) {
          tc.result = typeof chunk.output === "string" ? chunk.output : JSON.stringify(chunk.output);
        }
      }
    },

    onFinish: async () => {
      const elapsedMs = Date.now() - startTime;

      // Truncate text parts if needed
      let totalTextLength = parts
        .filter((p) => p.type === "text")
        .reduce((sum, p) => sum + p.text.length, 0);

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

      // Warn if BUILD mode has no tool calls
      if (mode === "BUILD" && parts.every((p) => p.type !== "tool-call")) {
        parts.push({
          type: "text",
          text: "\n⚠️ This model did not emit any tool calls in BUILD mode. It may not support tool calling reliably.",
        });
      }

      const fullText = parts
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("");

      const validatedParts: Prisma.InputJsonValue | undefined =
        parts.length > 0 ? (messagePartsSchema.parse(parts) as Prisma.InputJsonValue) : undefined;

      const modelKind = selection.modelKind;
      const modelRef = selection.modelKind === "builtin" ? selection.modelId : selection.connectionId;

      await db.message.create({
        data: {
          sessionId,
          role: "ASSISTANT",
          status: MessageStatus.COMPLETE,
          modelKind,
          modelRef,
          content: fullText,
          parts: validatedParts,
          mode,
          duration: Math.round(elapsedMs / 1000),
        },
      });
    },

    onError: async (error) => {
      const errMsg = sanitizeError(error);
      const modelKind = selection.modelKind;
      const modelRef = selection.modelKind === "builtin" ? selection.modelId : selection.connectionId;
      const cause = (error as { cause?: unknown })?.cause;
      const unwrapped = RetryError.isInstance(error) ? error.lastError : error;
      const apiError = APICallError.isInstance(unwrapped)
        ? { requestUrl: unwrapped.url, statusCode: unwrapped.statusCode, responseBody: unwrapped.responseBody }
        : APICallError.isInstance(cause)
          ? { requestUrl: cause.url, statusCode: cause.statusCode, responseBody: cause.responseBody }
          : undefined;
      log.warn("stream error", { sessionId, modelKind, modelRef, error: errMsg, ...apiError });
      await db.message.create({
        data: {
          sessionId,
          role: "ERROR",
          status: MessageStatus.COMPLETE,
          modelKind,
          modelRef,
          content: errMsg,
          mode,
        },
      });
    },

    onAbort: async () => {
      const fullText = parts
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("");
      if (fullText.length === 0 && parts.length === 0) return;
      const elapsedMs = Date.now() - startTime;
      const validatedParts = parts.length ? messagePartsSchema.parse(parts) : undefined;
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
    },
  });

  return result.toUIMessageStreamResponse({
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
    onError: (error) => sanitizeError(error),

    messageMetadata: ({ part }) => {
      if (part.type === "start") {
        return {
          mode,
          model:
            selection.modelKind === "builtin"
              ? selection.modelId
              : selection.connectionId,
        };
      }

      if (part.type === "finish") {
        return {
          mode,

          model:
            selection.modelKind === "builtin"
              ? selection.modelId
              : selection.connectionId,

          durationMs: Date.now() - startTime,

          usage: part.totalUsage,
        };
      }

      return undefined;
    },
  });
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
  const timeoutId = setTimeout(() => abortController.abort(), CHAT_TIMEOUT_MS);

  try {
    const response = await streamAIResponse({
      sessionId,
      userId,
      selection,
      cwd: session.cwd,
      history,
      mode: lastUser.mode,
      abortController,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (err) {
    clearTimeout(timeoutId);
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

app.post(
  "/:sessionId",
  async (c, next) => {
    console.log("DEBUG raw body:", await c.req.raw.clone().text());
    await next();
  },
  zValidator("json", submitSchema),
  async (c) => {
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
      data: {
        sessionId,
        role: "USER",
        status: MessageStatus.COMPLETE,
        modelKind,
        modelRef,
        content: data.content,
        mode: data.mode,
      },
    });

    const history = buildConversationHistory([
      ...session.messages,
      { role: "USER" as const, content: data.content, status: MessageStatus.COMPLETE },
    ]);

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), CHAT_TIMEOUT_MS);

    try {
      const response = await streamAIResponse({
        sessionId,
        userId,
        selection: data.model,
        cwd: session.cwd,
        history,
        mode: data.mode,
        abortController,
      });
      clearTimeout(timeoutId);
      return response;
    } catch (err) {
      clearTimeout(timeoutId);
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 500);
    }
  });

export default app;