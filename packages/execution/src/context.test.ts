// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Context Runtime tests (engine/context) — A-ENG-002: layered assembly,
// per-block + whole-system token caps, deterministic history trimming, and the
// runModel merge (system beneath strategy directive, guaranteed task brief).

import { describe, expect, it } from "bun:test";
import type { TurnMessage } from "@ANCIENT/strategies";
import {
    buildSystemPrompt,
    createContext,
    estimateTokens,
    trimHistory,
    truncateToTokenBudget,
    DEFAULT_HISTORY_BUDGET,
    DEFAULT_SYSTEM_BUDGET,
} from "./context";

function turn(i: number, text: string): TurnMessage {
    return { role: i % 2 === 0 ? "user" : "assistant", text };
}

describe("estimateTokens / truncateToTokenBudget", () => {
    it("estimates chars/4 and truncates to a token cap with a note", () => {
        const text = "a".repeat(400);
        expect(estimateTokens(text)).toBe(100);
        const cut = truncateToTokenBudget(text, 50);
        expect(cut.length).toBeLessThanOrEqual(200);
        expect(cut).toContain("truncated");
    });

    it("leaves under-budget text untouched", () => {
        expect(truncateToTokenBudget("short", 100)).toBe("short");
    });
});

describe("buildSystemPrompt", () => {
    it("lays identity first, then blocks in cheapest-information-first order", () => {
        const system = buildSystemPrompt({
            mode: "BUILD",
            cwd: "/work",
            today: "2026-08-29",
            blocks: { skills: "## Skills\n- **build**", memory: "## Memory\nproject conventions" },
        });
        expect(system.indexOf("You are ANCIENT")).toBe(0);
        expect(system.indexOf("## Memory")).toBeLessThan(system.indexOf("## Skills"));
        expect(system).toContain("Mode: BUILD");
        expect(system).toContain("Working directory: /work");
        expect(system).toContain("Today's date: 2026-08-29");
    });

    it("caps an over-budget block and then the whole system prompt", () => {
        const bigMemory = "m".repeat(100_000);
        const system = buildSystemPrompt({
            mode: "PLAN",
            blocks: { memory: bigMemory },
            budgets: { memory: 1_000 },
            systemBudget: 500,
        });
        expect(system.length).toBeLessThanOrEqual(500 * 4);
        expect(system).toContain("truncated");
        expect(system).toContain("read-only analysis");
    });

    it("budgets each block before layering them", () => {
        const system = buildSystemPrompt({
            mode: "BUILD",
            blocks: { skills: "## Skills\n" + "s".repeat(2000), session: "## Session\n" + "x".repeat(2000) },
            budgets: { skills: 100, session: 50 },
        });
        const skillsEnd = system.indexOf("## Session");
        const skillsSegment = system.slice(system.indexOf("## Skills"), skillsEnd);
        expect(skillsSegment.length).toBeLessThanOrEqual(100 * 4 + 2); // +2 for the layer separator
        const sessionLen = system.length - skillsEnd;
        expect(sessionLen).toBeLessThanOrEqual(50 * 4);
    });
});

describe("trimHistory", () => {
    it("keeps everything under budget", () => {
        const history = [turn(0, "hi"), turn(1, "howdy"), turn(2, "bye")];
        expect(trimHistory(history, 10_000)).toEqual(history);
    });

    it("keeps the newest turns when over budget", () => {
        const history = [
            turn(0, "a".repeat(5_000)),
            turn(1, "b".repeat(5_000)),
            turn(2, "c".repeat(100)),
            turn(3, "d".repeat(100)),
        ];
        const kept = trimHistory(history, 30); // 120 chars — only the last turn fits
        expect(kept.length).toBe(1);
        expect(kept[0]!.text).toBe("d".repeat(100));
    });

    it("never drops the most recent message even when it alone exceeds the cap", () => {
        const history = [turn(0, "old"), turn(1, "huge".repeat(10_000))];
        const kept = trimHistory(history, 10);
        expect(kept).toHaveLength(1);
        expect(kept[0]!.text.startsWith("huge")).toBe(true);
    });

    it("handles empty history", () => {
        expect(trimHistory([], 100)).toEqual([]);
    });
});

describe("createContext + runModel semantics", () => {
    it("assembles a system with a guaranteed task brief and trimming", () => {
        const ctx = createContext({
            task: "fix the tests",
            mode: "BUILD",
            cwd: null,
            blocks: { memory: "## Memory\nconventions" },
        });
        expect(ctx.system).toContain("## Memory");
        expect(ctx.brief).toBe("Task: fix the tests");

        const longHistory = Array.from({ length: 4_000 }, (_, i) => turn(i, "line".repeat(20)));
        const trimmed = ctx.trimHistory(longHistory);
        expect(trimmed.length).toBeLessThan(longHistory.length);
        expect(trimmed.at(-1)).toEqual(longHistory.at(-1));
        expect(estimateTokens(trimmed.map((t) => t.text).join(""))).toBeLessThanOrEqual(DEFAULT_HISTORY_BUDGET + 1);
    });

    it("default budgets match the constants used by the engine", () => {
        const ctx = createContext({ task: "t", mode: "PLAN" });
        // default system budget cap applies to the assembled prompt
        expect(estimateTokens(ctx.system)).toBeLessThanOrEqual(DEFAULT_SYSTEM_BUDGET);
    });
});