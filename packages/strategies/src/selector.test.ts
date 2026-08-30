// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Strategy selector tests (strategies) — the ladder decision is pure and
// deterministic (A-STRAT-001).

import { describe, expect, it } from "bun:test";
import { strategyCatalog, StrategySelector, wiredStrategies } from "./registry";
import { selectStrategy, wantedRung } from "./selector";
import type { TaskProfile } from "./types";

const selector = new StrategySelector();
const profile = (p: Partial<TaskProfile> & { description: string }): TaskProfile => p as TaskProfile;

describe("wantedRung", () => {
    it("maps each complexity tier up the ladder", () => {
        expect(wantedRung({ description: "x", complexity: "trivial" })).toBe(0);
        expect(wantedRung({ description: "x", complexity: "simple" })).toBe(0);
        expect(wantedRung({ description: "x", complexity: "moderate" })).toBe(1);
        expect(wantedRung({ description: "x", complexity: "complex" })).toBe(2);
        expect(wantedRung({ description: "x", complexity: "very-complex" })).toBe(3);
    });

    it("bumps to parallel work for parallelizable profiles", () => {
        expect(wantedRung({ description: "x", complexity: "simple", parallelizable: true })).toBe(2);
    });

    it("bumps rungs for very large tasks", () => {
        expect(wantedRung({ description: "x", complexity: "moderate", estimatedTokens: 100_000 })).toBe(2);
    });
});

describe("selectStrategy", () => {
    it("picks direct for trivial/simple work", () => {
        const s = selector.select(profile({ description: "format this file", complexity: "simple" }));
        expect(s.id).toBe("direct");
        expect(s.rung).toBe(0);
    });

    it("picks agent-loop for moderate work", () => {
        const s = selector.select(profile({ description: "add a feature across a few files", complexity: "moderate", tools: ["edit-file"] }));
        expect(s.id).toBe("agent-loop");
        expect(s.rung).toBe(1);
    });

    it("picks subagents for complex work", () => {
        const s = selector.select(profile({ description: "refactor the auth subsystem", complexity: "complex" }));
        expect(s.id).toBe("subagents");
        expect(s.rung).toBe(2);
        expect(s.reason).toContain("subagents@r2");
    });

    it("falls back below an unwired top rung (teams unreachable)", () => {
        const s = selector.select(profile({ description: "huge multi-team effort", complexity: "very-complex", parallelizable: true }));
        expect(s.id).toBe("subagents");
    });

    it("honors an explicit wired preference", () => {
        const s = selector.select(profile({ description: "x", complexity: "trivial", preferredStrategy: "agent-loop" }));
        expect(s.id).toBe("agent-loop");
        expect(s.reason).toContain("preferred agent-loop");
    });

    it("falls back when the preference is unwired", () => {
        const s = selector.select(profile({ description: "x", complexity: "trivial", preferredStrategy: "arena" }));
        expect(s.id).toBe("direct");
        expect(s.reason).toContain("unwired/unfit");
    });

    it("never returns an unwired strategy", () => {
        for (const tier of ["trivial", "simple", "moderate", "complex", "very-complex"] as const) {
            const s = selector.select(profile({ description: "x", complexity: tier, parallelizable: true }));
            expect(s.id).not.toBe("teams");
            expect(s.id).not.toBe("arena");
        }
    });

    it("throws when the catalog has no wired strategies", () => {
        const onlyUnwired = strategyCatalog.filter((s) => !s.wired);
        expect(() => selectStrategy(profile({ description: "x" }), onlyUnwired)).toThrow("no wired strategies");
    });

    it("honors the rung floor on re-selection (escalation)", () => {
        // Even a "simple" profile must not re-run the same rung that just
        // under-delivered — the floor forces the next heavier strategy.
        const s = selector.select(profile({ description: "read the config", complexity: "simple" }), { minRung: 1 });
        expect(s.id).toBe("agent-loop");
        expect(s.rung).toBe(1);
    });

    it("jumps to subagents when the floor is rung 2", () => {
        // moderate + floor 2: lower rungs are excluded and subagents wins the
        // at-or-above fallback — the re-selection refuses to downgrade.
        const s = selector.select(profile({ description: "x", complexity: "moderate" }), { minRung: 2 });
        expect(s.id).toBe("subagents");
        expect(s.rung).toBe(2);
    });

    it("direct no longer claims moderate work (moderate → agent-loop)", () => {
        const s = selector.select(profile({ description: "wire the auth flow", complexity: "moderate" }));
        expect(s.id).toBe("agent-loop");
        expect(s.rung).toBe(1);
    });
});

describe("catalog integrity", () => {
    it("registers all five ladder rungs in order", () => {
        expect(strategyCatalog.map((s) => s.id)).toEqual(["direct", "agent-loop", "subagents", "teams", "arena"]);
        expect(strategyCatalog.map((s) => s.rung)).toEqual([0, 1, 2, 3, 4]);
    });

    it("wires the first three, catalogues the last two", () => {
        expect(wiredStrategies.map((s) => s.id)).toEqual(["direct", "agent-loop", "subagents"]);
        expect(strategyCatalog.find((s) => s.id === "teams")?.wired).toBe(false);
        expect(strategyCatalog.find((s) => s.id === "arena")?.wired).toBe(false);
    });

    it("exposes has() for ladder ids and selector wrapper consistency", () => {
        expect(selector.has("arena")).toBe(true);
        expect(selector.listWired().map((s) => s.id)).toEqual(["direct", "agent-loop", "subagents"]);
    });
});