// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Profiler tests (engine) — TaskProfile inference is pure and deterministic.

import { describe, expect, it } from "bun:test";
import { detectParallelizable, estimateTokens, inferProfile, tierFromScore } from "./profiler";

describe("tierFromScore", () => {
    it("maps the routing score to ladder-compatible tiers", () => {
        expect(tierFromScore(0)).toBe("simple");
        expect(tierFromScore(-2)).toBe("simple");
        expect(tierFromScore(1)).toBe("moderate");
        expect(tierFromScore(2)).toBe("moderate");
        expect(tierFromScore(3)).toBe("complex");
        expect(tierFromScore(5)).toBe("complex");
        expect(tierFromScore(6)).toBe("very-complex");
        expect(tierFromScore(12)).toBe("very-complex");
    });
});

describe("inferProfile", () => {
    it("classes a tiny formatting task as simple (direct territory)", () => {
        const p = inferProfile("rename this variable to userCount");
        expect(p.complexity).toBe("simple");
        expect(p.parallelizable).toBe(false);
        expect(p.mode).toBe("BUILD");
    });

    it("classes heavy multi-file refactors as complex", () => {
        const p = inferProfile("refactor the auth subsystem across the codebase and migrate it; " +
            "debug the stack trace from the payment race condition; also add a test suite for the whole project");
        expect(p.complexity).toBe("very-complex");
    });

    it("bumps PLAN mode up a tier via the planner heuristic", () => {
        const task = "explore the chat route";
        const inBuild = inferProfile(task, "BUILD");
        const inPlan = inferProfile(task, "PLAN");
        expect(inPlan.complexity).not.toBe("simple");
        expect(tierToRank(inPlan.complexity ?? "simple") >= tierToRank(inBuild.complexity ?? "simple")).toBe(true);
    });

    function tierToRank(t: string): number {
        return ["trivial", "simple", "moderate", "complex", "very-complex"].indexOf(t);
    }

    it("explicit hints win over inference (engine decides, not the profiler)", () => {
        const p = inferProfile(
            "rename this variable to userCount",
            "BUILD",
            { complexity: "very-complex", estimatedTokens: 9_999, preferredStrategy: "subagents" },
        );
        expect(p.complexity).toBe("very-complex");
        expect(p.estimatedTokens).toBe(9_999);
        expect(p.preferredStrategy).toBe("subagents");
    });

    it("detects parallelizable hints and known tool names", () => {
        const p = inferProfile("run these greps and edits across many files in parallel: readFile, writeFile");
        expect(p.parallelizable).toBe(true);
        expect(p.tools).toContain("grep");
        expect(p.tools).toContain("readFile");
        expect(p.tools).toContain("writeFile");
    });
});

describe("estimateTokens", () => {
    it("is floor + length-based and deterministic", () => {
        const a = estimateTokens("x", "simple");
        const b = estimateTokens("x", "simple");
        expect(a).toBe(b);
        expect(a).toBeGreaterThanOrEqual(800);
        expect(estimateTokens("x", "complex")).toBeGreaterThan(estimateTokens("x", "simple"));
    });
});