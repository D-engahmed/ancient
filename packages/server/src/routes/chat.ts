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

import { createToolsAsync } from "../tools";
import { buildSystemPrompt } from "../system-prompt";
import { Redactor } from "@ANCIENT/infrastructure/security";
import { resolveChatModel, resolveFreeModel, type ResolvedModel } from "../lib/models";
import { modelKey, checkCooldown, recordRateLimitFailure, isRateLimitError, RateLimitCooldownError } from "../lib/rate-limit-breaker";
import { selectHealthyFallbackModel } from "../lib/fallback";
import type { AuthenticatedEnv } from "../middleware/require-auth";
import { loadSettings, type AncientSettings } from "../hooks/settings";
import { runHooks, type HookContext } from "../hooks/runner";
import { loadMemory, buildMemoryPromptBlock } from "../memory/loader";
import { listSkills, buildSkillsPromptBlock } from "../skills/loader";
import { listAgents, buildAgentsPromptBlock } from "../agents/loader";
import { listMcpServers } from "../mcp/client";
import { expandSlashCommand, listCommands } from "../commands/loader";
import { routeTurn } from "../lib/model-router";
import { createCheckpoint } from "../checkpoints/store";
import { parseQuotaFromError, persistQuota } from "../lib/quota";
import { errorJson, guardJson } from "../lib/error-mapper";

const log = createLogger("chat");

// R7: provider error bodies can echo the very credentials that failed (an
// auth error repeating the Authorization header, a gateway echoing `api_key`)
// and the shared logger's key-name redaction can't see inside a string field.
// Every error surface below (log line + persisted ERROR message) passes
// through this redactor first.
const errorRedactor = new Redactor();

const MAX_RESPONSE_CHARS = Number.parseInt(process.env.ANCIENT_MAX_RESPONSE_CHARS ?? "200000", 10);
// Raised from 60s: subagent tasks and MCP tools legitimately run longer.
const CHAT_TIMEOUT_MS = Number.parseInt(process.env.ANCIENT_CHAT_TIMEOUT_MS ?? "300000", 10);
const MAX_TOOL_STEPS = Number.parseInt(process.env.ANCIENT_MAX_TOOL_STEPS ?? "50", 10);

/** Marker prefix for compaction summaries — see routes/extensions.ts /compact. */
export const SUMMARY_MARKER = "<ancient-context-summary>";

function toolCallParts(parts: MessagePart[]) {
  return parts.filter(
    (p): p is Extract<MessagePart, { type: "tool-call" }> => p.type === "tool-call",
  );
}

/**
 * Bounded graceful fallback when the user-selected model is rate-limited.
 * Returns a healthy alternative (never the primary itself, never one currently
 * on cooldown) in priority order: the configured freeModel, then the builtin
 * default. Returns null when no candidate is resolvable/healthy — in that case
 * the caller throws the normal cooldown error so the user's explicit model
 * choice is still respected (and never silently replaced by a model we know
 * is also rate-limited, which would just produce a second confusing failure).
 */
/**
 * Rebuilds the message array sent back to the model from DB rows.
 *
 * Reconstructs real ModelMessage[] from `parts`: an assistant message
 * (text + tool-call parts) followed by a tool message (matching tool-result
 * parts), the shape most providers require for multi-step tool
 * conversations. A tool-call with no `result` (saved mid-flight by onAbort)
 * still gets a synthetic tool-result — most providers reject a request
 * where a tool-call has no matching tool-result in the next message.
 *
 * Compaction: if a context-summary message exists (created by /compact),
 * everything before the latest one is dropped — the summary replaces it.
 */
function buildConversationHistory(
  messages: {
    role: "USER" | "ASSISTANT" | "ERROR";
    content: string;
    parts?: unknown;
    status: MessageStatus;
  }[],
): ModelMessage[] {
  // Find the latest compaction summary and discard everything before it.
  let startIndex = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === "USER" && m.content.startsWith(SUMMARY_MARKER)) {
      startIndex = i;
      break;
    }
  }
  const window = messages.slice(startIndex);
  const result: ModelMessage[] = [];

  for (const m of window) {
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

type StreamParams = {
  sessionId: string;
  userId: string;
  /** The user's selection — used for persistence + subagent inheritance. */
  selection: ChatModelSelection;
  /** Set when the model router moved this turn to the free lane. */
  preResolved?: ResolvedModel;
  routeReason?: string;
  cwd: string | null;
  history: ModelMessage[];
  mode: Mode;
  settings: AncientSettings;
  /** Extra context injected by UserPromptSubmit/SessionStart hooks. */
  hookContext?: string;
  abortController: AbortController;
};

async function streamAIResponse(params: StreamParams): Promise<Response> {
  const {
    sessionId, userId, selection, preResolved, routeReason: initialRouteReason,
    cwd, history, mode, settings, hookContext, abortController,
  } = params;
  const startTime = Date.now();
  const parts: MessagePart[] = [];

  // Mutable — a rate-limit fallback (below) replaces the effective model and
  // rewrites the human-facing routing note for this turn.
  let routeReason = initialRouteReason;

  let resolved = preResolved ?? await resolveChatModel(selection, userId);
  // True when this turn is run on the free lane (either pre-routed by the
  // model router, or adopted as a rate-limit fallback). Drives how the turn's
  // model is reported/persisted (free:... ref) below.
  let usedFreeLane = Boolean(preResolved);
  // True when a rate-limit fallback replaced this turn's model. Drives the
  // persisted/meta model ref so it reflects what actually ran, not the
  // user's (unavailable) original selection.
  let fellBack = false;

  // Fail fast if this exact model tripped a rate limit recently, instead of
  // spending another ~3-attempt retry cycle (each with backoff) against a
  // limit that hasn't reset yet — that multi-attempt round trip is why the
  // error took a while to surface and then repeated on every retry. See
  // rate-limit-breaker.ts. When a model is on cooldown we try a healthy
  // fallback model first. Only if no healthy alternative exists do we surface
  // the cooldown error.
  let rlKey = modelKey(resolved.provider, resolved.modelId);
  const cooldown = checkCooldown(rlKey);
  if (cooldown.onCooldown) {
    const fallback = selectHealthyFallbackModel(settings, rlKey);
    if (fallback) {
      usedFreeLane = fallback.isFree || usedFreeLane;
      fellBack = true;
      log.info("selected model on cooldown — falling back for this turn", {
        sessionId,
        blocked: resolved.modelId,
        retryAfterSeconds: cooldown.retryAfterSeconds,
        fallback: fallback.resolved.modelId,
      });
      const primaryWas = resolved.modelId;
      resolved = fallback.resolved;
      rlKey = modelKey(resolved.provider, resolved.modelId);
      routeReason = `your selected model (\`${primaryWas}\`) is rate-limited (~${cooldown.retryAfterSeconds}s) — using \`${resolved.modelId}\` for this reply instead`;
    } else {
      throw new RateLimitCooldownError(resolved.modelId, cooldown.retryAfterSeconds);
    }
  }

  const model = resolved.model;
  const apiKey = resolved.apiKey;
  // Free models are on shared pools that rate-limit aggressively — fail fast
  // (no SDK retries) so the cooldown + fallback path kicks in on the NEXT call
  // instead of wasting 3 attempts against a limit that hasn't reset.
  const maxRetries = usedFreeLane ? 0 : undefined;
  // The model ref this turn actually ran on — surfaced in persisted messages
  // and stream metadata (see messageMetadata below).
  const usedModelRef = usedFreeLane
    ? `free:${resolved.modelId}`
    : fellBack
      ? `fallback:${resolved.modelId}`
      : selection.modelKind === "builtin" ? selection.modelId : selection.connectionId;

  // ---- Assemble the layered system prompt (each block self-budgets) ----
  let memoryBlock = "";
  let skillsBlock = "";
  let agentsBlock = "";
  let mcpBlock = "";
  if (cwd) {
    const [memory, skills, agents, mcpStatuses] = await Promise.all([
      loadMemory(cwd),
      listSkills(cwd),
      listAgents(cwd),
      settings.mcp?.enabled === false ? Promise.resolve([]) : listMcpServers(cwd).catch(() => []),
    ]);
    memoryBlock = buildMemoryPromptBlock(memory);
    skillsBlock = buildSkillsPromptBlock(skills);
    agentsBlock = buildAgentsPromptBlock(agents);
    if (mcpStatuses.length > 0) {
      const lines = mcpStatuses.map((s) =>
        s.connected
          ? `- **${s.name}** — connected, ${s.toolCount} tool(s) available as \`mcp__${s.name}__*\``
          : `- **${s.name}** — unavailable (${s.error ?? "connection failed"})`);
      mcpBlock = ["## MCP Servers", ...lines].join("\n");
    }
  }

  const hookContextFull: HookContext | undefined = cwd
    ? { cwd, sessionId, settings }
    : undefined;

  const tools = cwd
    ? await createToolsAsync(cwd, mode, {
      sessionId,
      userId,
      selection,
      hookContext: hookContextFull,
    })
    : undefined;

  // Gateways like OpenRouter deliberately collapse the real failure into a
  // generic top-level message (e.g. "Provider returned error") and put the
  // actual upstream detail in error.metadata.raw inside the JSON response
  // body. @ai-sdk's error classes normally carry that body on
  // `.responseBody`, but we duck-type it here (rather than requiring
  // `APICallError.isInstance`) because retries/wrapping can lose the exact
  // class identity while the property itself survives.
  const extractUpstreamDetail = (err: unknown): string | undefined => {
    if (!err || typeof err !== "object") return undefined;
    const responseBody = (err as { responseBody?: unknown }).responseBody;
    if (typeof responseBody !== "string" || responseBody.length === 0) return undefined;
    try {
      const parsed = JSON.parse(responseBody) as {
        error?: { message?: unknown; metadata?: { raw?: unknown; provider_name?: unknown } };
      };
      const metadata = parsed.error?.metadata;
      let raw = metadata?.raw;
      if (typeof raw === "string") {
        // OpenRouter's `raw` is often itself a JSON-encoded upstream error.
        try {
          const rawParsed = JSON.parse(raw) as { error?: { message?: unknown } };
          if (typeof rawParsed.error?.message === "string") raw = rawParsed.error.message;
        } catch {
          // raw wasn't JSON — use it as-is.
        }
      }
      const detail = typeof raw === "string" ? raw : typeof parsed.error?.message === "string" ? parsed.error.message : undefined;
      if (!detail) return undefined;
      const providerName = typeof metadata?.provider_name === "string" ? metadata.provider_name : undefined;
      return providerName ? `${providerName}: ${detail}` : detail;
    } catch {
      return undefined;
    }
  };

  const sanitizeError = (err: unknown): string => {
    // Unwrap ai SDK retry wrapping to get at the error that actually failed.
    const lastError = err && typeof err === "object" ? (err as { lastError?: unknown }).lastError : undefined;
    const upstreamDetail = extractUpstreamDetail(lastError) ?? extractUpstreamDetail(err)
      ?? extractUpstreamDetail((err as { cause?: unknown })?.cause);

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
    if (upstreamDetail && !msg.includes(upstreamDetail)) {
      msg = `${msg} — ${upstreamDetail}`;
    }
    if (apiKey && typeof msg === "string") {
      const escaped = apiKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      msg = msg.replace(new RegExp(escaped, "g"), "[REDACTED]");
    }
    return msg;
  };

  const result = streamText({
    model,
    maxRetries,
    system: buildSystemPrompt({
      cwd,
      mode,
      memoryBlock,
      skillsBlock,
      agentsBlock,
      mcpBlock,
      hookContext,
      today: new Date().toISOString().slice(0, 10),
    }),
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
      const modelRef = usedModelRef;

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

    // NOTE: streamText's `onError` callback receives `{ error }` — a wrapper
    // object, not the error itself (see StreamTextOnErrorCallback = Callback<{
    // error: unknown }> in the ai package's types). This previously destructured
    // the parameter as if it *were* the error, so `RetryError.isInstance(error)`,
    // `APICallError.isInstance(...)`, and the `.cause` lookup below were all
    // silently checking the wrapper object instead of the real error — they
    // never matched, so `apiError` was always undefined here. (sanitizeError's
    // own `err.error` fallback masked this for the top-level message text,
    // which is why the *displayed* error still looked reasonable while the
    // richer detail silently failed to make it into this log line or the
    // persisted DB message.) Destructuring `{ error }` here fixes that.
    onError: async ({ error }) => {
      // sanitizeError strips the exact apiKey from the text; the redactor
      // additionally masks *patterned* secrets (bearer tokens, sk-…, labeled
      // api_key=…) that survive inside wrapped provider messages.
      const errMsg = errorRedactor.mask(sanitizeError(error));
      const modelKind = selection.modelKind;
      const modelRef = usedModelRef;
      const cause = (error as { cause?: unknown })?.cause;
      const unwrapped = RetryError.isInstance(error) ? error.lastError : error;

      // Trip the breaker so the NEXT turn on this exact model fails fast
      // (see the cooldown check above) instead of repeating this same
      // multi-attempt retry cycle against a limit that hasn't reset.
      if (isRateLimitError(error)) {
        recordRateLimitFailure(rlKey);
      }

      const apiError = APICallError.isInstance(unwrapped)
        ? { requestUrl: unwrapped.url, statusCode: unwrapped.statusCode, responseBody: unwrapped.responseBody }
        : APICallError.isInstance(cause)
          ? { requestUrl: cause.url, statusCode: cause.statusCode, responseBody: cause.responseBody }
          // Duck-typed fallback: some wrapped/retried errors carry the same
          // shape (url/statusCode/responseBody) without passing the branded
          // isInstance check, and we'd otherwise silently drop the detail
          // that errMsg above already worked to surface.
          : unwrapped && typeof unwrapped === "object" && "responseBody" in unwrapped
            ? {
              requestUrl: (unwrapped as { url?: unknown }).url,
              statusCode: (unwrapped as { statusCode?: unknown }).statusCode,
              responseBody: (unwrapped as { responseBody?: unknown }).responseBody,
            }
            : undefined;
      // R7: log the masked body — the raw one may embed the failed request's
      // credentials. Quota learning below still reads the raw body.
      const loggedApiError = apiError
        ? {
          ...apiError,
          responseBody:
            typeof apiError.responseBody === "string"
              ? errorRedactor.mask(apiError.responseBody)
              : apiError.responseBody,
        }
        : undefined;
      log.warn("stream error", { sessionId, modelKind, modelRef, error: errMsg, ...loggedApiError });

      // Learn this connection's real quota, if the provider just told us
      // one, so the /usage graph reflects an actual reported limit instead
      // of a guess. No-op for shared-pool 429s (e.g. OpenRouter's) that
      // don't carry a concrete personal quota number — see quota.ts.
      if (selection.modelKind === "custom" && typeof apiError?.responseBody === "string") {
        const quota = parseQuotaFromError(apiError.responseBody);
        if (quota) {
          await persistQuota(selection.connectionId, quota);
        }
      }

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
      const validatedParts = parts.length ? (messagePartsSchema.parse(parts) as Prisma.InputJsonValue) : undefined;
      const modelKind = selection.modelKind;
      const modelRef = usedModelRef;
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
    onError: (error) => errorRedactor.mask(sanitizeError(error)),

    messageMetadata: ({ part }) => {
      const turnModel = usedModelRef;

      if (part.type === "start") {
        return {
          mode,
          model: turnModel,
          routed: routeReason,
        };
      }

      if (part.type === "finish") {
        return {
          mode,
          model: turnModel,
          routed: routeReason,
          durationMs: Date.now() - startTime,
          usage: part.totalUsage,
        };
      }

      return undefined;
    },
  });
}

/**
 * Shared turn preparation for POST /:sessionId: slash-command expansion,
 * hooks, checkpointing, model routing. Returns either an error response or
 * everything streamAIResponse needs.
 */
async function prepareTurn(params: {
  sessionId: string;
  userId: string;
  content: string;
  mode: Mode;
  cwd: string | null;
  isFirstMessage: boolean;
}): Promise<
  | { ok: true; content: string; settings: AncientSettings; hookContext?: string; preResolved?: ResolvedModel; routeReason?: string }
  | { ok: false; status: 400; error: string }
> {
  const { sessionId, cwd, mode, isFirstMessage } = params;
  const settings = await loadSettings(cwd);

  // ---- Slash commands ----
  const expansion = await expandSlashCommand(params.content, cwd);
  if (expansion.kind === "ui-command") {
    return { ok: false, status: 400, error: `/${expansion.name} is a UI command — run it from the command menu (Ctrl+K) instead of the chat input.` };
  }
  if (expansion.kind === "unknown") {
    const available = (await listCommands(cwd)).map((c) => `/${c.name}`).join(", ");
    return { ok: false, status: 400, error: `Unknown command: /${expansion.name}. Available: ${available || "(none)"}` };
  }
  const content = expansion.kind === "expanded" ? expansion.content : params.content;

  // ---- Lifecycle hooks ----
  let hookContext: string | undefined;
  if (cwd) {
    const hookCtx: HookContext = { cwd, sessionId, settings };
    const contextBits: string[] = [];
    if (isFirstMessage) {
      const outputs = await runHooks(hookCtx, "SessionStart", { source: "startup" });
      contextBits.push(...outputs.map((o) => o.additionalContext).filter((s): s is string => Boolean(s)));
    }
    const promptOutputs = await runHooks(hookCtx, "UserPromptSubmit", { prompt: content });
    contextBits.push(...promptOutputs.map((o) => o.additionalContext).filter((s): s is string => Boolean(s)));
    if (contextBits.length > 0) hookContext = contextBits.join("\n\n");
  }

  // ---- Checkpoint before BUILD turns ----
  if (cwd && mode === Mode.BUILD && settings.checkpoints?.enabled !== false) {
    await createCheckpoint(cwd, sessionId, content).catch(() => null);
  }

  // ---- Model routing (free-first lane) ----
  const route = routeTurn(content, mode, settings.modelRouting);
  let preResolved: ResolvedModel | undefined;
  let routeReason = route.reason;
  if (route.lane === "free") {
    const free = resolveFreeModel(settings.modelRouting?.freeModel);
    if (free) {
      const freeCooldown = checkCooldown(modelKey(free.provider, free.modelId));
      if (freeCooldown.onCooldown) {
        // The free model was rate-limited recently — don't route into it
        // again this turn; stay on the user's selected model instead. The
        // selected-model path still has its own cooldown check right before
        // the call, so this can't loop into another guaranteed failure.
        routeReason = `free model on cooldown (~${freeCooldown.retryAfterSeconds}s left) after a recent rate limit — using your selected model instead`;
        log.info("free model on cooldown, staying on selected model", {
          sessionId, model: free.modelId, retryAfterSeconds: freeCooldown.retryAfterSeconds,
        });
      } else {
        preResolved = free;
        log.info("routed to free model", { sessionId, model: free.modelId, score: route.score });
      }
    }
  }

  return { ok: true, content, settings, hookContext, preResolved, routeReason };
}

const app = new Hono<AuthenticatedEnv>();

app.post(
  "/:sessionId",
  zValidator("json", submitSchema),
  async (c) => {
    const sessionId = c.req.param("sessionId");
    const userId = c.get("userId");

    const session = await db.session.findUnique({
      where: { id: sessionId, userId },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!session) return guardJson(c, "Session not found", 404);

    const data = c.req.valid("json");

    const prepared = await prepareTurn({
      sessionId,
      userId,
      content: data.content,
      mode: data.mode,
      cwd: session.cwd,
      isFirstMessage: session.messages.length === 0,
    });
    if (!prepared.ok) return guardJson(c, prepared.error, prepared.status);

    const modelKind = data.model.modelKind;
    const modelRef = data.model.modelKind === "builtin" ? data.model.modelId : data.model.connectionId;

    await db.message.create({
      data: {
        sessionId,
        role: "USER",
        status: MessageStatus.COMPLETE,
        modelKind,
        modelRef,
        content: prepared.content,
        mode: data.mode,
      },
    });

    const history = buildConversationHistory([
      ...session.messages,
      { role: "USER" as const, content: prepared.content, status: MessageStatus.COMPLETE },
    ]);

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), CHAT_TIMEOUT_MS);

    try {
      const response = await streamAIResponse({
        sessionId,
        userId,
        selection: data.model,
        preResolved: prepared.preResolved,
        routeReason: prepared.routeReason,
        cwd: session.cwd,
        history,
        mode: data.mode,
        settings: prepared.settings,
        hookContext: prepared.hookContext,
        abortController,
      });
      clearTimeout(timeoutId);
      return response;
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof RateLimitCooldownError) {
        c.header("Retry-After", String(err.retryAfterSeconds));
        return c.json({ error: err.message }, 429);
      }
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 500);
    }
  });

export default app;