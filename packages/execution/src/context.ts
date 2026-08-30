// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Engine Context Runtime (engine/context) — A-ENG-002. The engine's model-facing
// context for a run: assemble the system prompt from layered, self-budgeted blocks
// (identity + mode + cwd/date first, then memory, skills index, agents, MCP, and
// session/hook context, cheapest-information-first), apply deterministic token
// budgeting (chars/4, the infra convention), and trim history at the runModel port.
//
// Block producers stay in their owning layers (infrastructure/memory, capabilities/
// skills, gateway hooks) — the engine consumes pre-rendered blocks and never reads
// disk or runs I/O. Strategies state intent; the Context Runtime owns context
// (per docs/architecture/CONTEXT.md).

import type { ModeType } from "@ANCIENT/shared";
import type { TurnMessage } from "@ANCIENT/strategies";
import type { ContextBlock, EngineContextOptions } from "./types";

const CHARS_PER_TOKEN = 4;

/** Layer order for the system prompt — cheapest, most-generic information first. */
const CONTEXT_BLOCK_ORDER: readonly ContextBlock[] = ["memory", "skills", "agents", "mcp", "session"];

export const DEFAULT_BLOCK_BUDGETS: Record<ContextBlock, number> = {
    memory: 4_096, // full ANCIENT.md budget ≈ 16 KiB
    skills: 2_048, // ~50-skill standing index
    agents: 2_048,
    mcp: 1_536,
    session: 1_024, // hook/session context
};

/** Whole-assembled-system cap, applied last. */
export const DEFAULT_SYSTEM_BUDGET = 8_192;

/** Whole-conversation history cap applied at runModel. */
export const DEFAULT_HISTORY_BUDGET = 16_000;

export function estimateTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function truncateToTokenBudget(
    text: string,
    maxTokens: number,
    suffix = `\n...(truncated to ${maxTokens} tokens)`,
): string {
    const maxChars = maxTokens * CHARS_PER_TOKEN;
    if (text.length <= maxChars) return text;
    return text.slice(0, maxChars - suffix.length) + suffix;
}

export type SystemPromptInput = {
    mode: ModeType;
    cwd?: string | null;
    today?: string;
    blocks?: Partial<Record<ContextBlock, string>>;
    budgets?: Partial<Record<ContextBlock, number>>;
    systemBudget?: number;
};

/** Compose the layered engine system prompt (identity first, blocks after). */
export function buildSystemPrompt(input: SystemPromptInput): string {
    const budgets = { ...DEFAULT_BLOCK_BUDGETS, ...input.budgets };

    const identity = [
        "You are ANCIENT, an expert software engineer working as an execution engine.",
        `Mode: ${input.mode}${
            input.mode === "PLAN" ? " — read-only analysis and planning; do not modify anything." : " — full implementation."
        }`,
        input.cwd ? `Working directory: ${input.cwd}` : "",
        input.today ? `Today's date: ${input.today}` : "",
    ]
        .filter(Boolean)
        .join("\n");

    const layers = CONTEXT_BLOCK_ORDER.filter((key) => input.blocks?.[key]).map((key) =>
        truncateToTokenBudget(input.blocks![key]!, budgets[key]),
    );

    const layered = layers.length > 0 ? `\n\n${layers.join("\n\n")}` : "";
    return truncateToTokenBudget(identity + layered, input.systemBudget ?? DEFAULT_SYSTEM_BUDGET);
}

/**
 * Trim conversation history to a token budget, keeping the newest turns. The
 * most recent message is never dropped outright — a strategy always sees where
 * the conversation stands, even if a single tool result blows the cap.
 */
export function trimHistory(history: readonly TurnMessage[], budgetTokens: number): TurnMessage[] {
    const cap = Math.max(1, budgetTokens) * CHARS_PER_TOKEN;
    const kept: TurnMessage[] = [];
    let chars = 0;
    for (let i = history.length - 1; i >= 0; i--) {
        const message = history[i]!;
        if (kept.length > 0 && chars + message.text.length > cap) break;
        kept.unshift(message);
        chars += message.text.length;
    }
    return kept;
}

export type EngineContext = {
    /** The assembled engine system prompt (strategy directives are appended by the runtime). */
    readonly system: string;
    /** Guaranteed task framing for the model prompt, filled in by the runtime. */
    readonly brief: string;
    /** Budget-capped history view for a strategy turn. */
    trimHistory: (history: readonly TurnMessage[]) => TurnMessage[];
};

/** Build the engine-owned context for one run (A-ENG-002). */
export function createContext(opts: EngineContextOptions & { task: string; mode: ModeType; cwd?: string | null; today?: string }): EngineContext {
    const system = buildSystemPrompt({
        mode: opts.mode,
        cwd: opts.cwd,
        today: opts.today,
        blocks: opts.blocks,
        budgets: opts.budgets,
        systemBudget: opts.systemBudget,
    });
    const historyBudget = opts.historyBudget ?? DEFAULT_HISTORY_BUDGET;
    return {
        system,
        brief: `Task: ${opts.task}`,
        trimHistory: (history) => trimHistory(history, historyBudget),
    };
}