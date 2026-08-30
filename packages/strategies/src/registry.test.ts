// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Strategy registry tests (strategies) — catalog shape + unwired behavior.

import { describe, expect, it } from "bun:test";
import { collect } from "./test-collect";
import { fakeRuntime } from "./test-fakes";
import { STRATEGY_LADDER, type ExecutionStrategy } from "./types";
import { strategyCatalog } from "./registry";

describe("catalog", () => {
    it("matches the ladder exactly", () => {
        expect(strategyCatalog.map((s) => s.id)).toEqual([...STRATEGY_LADDER]);
    });

    it("defines the target rungs as leaves off the engine trunk", () => {
        const rungOf = (id: (typeof STRATEGY_LADDER)[number]) => strategyCatalog.find((s) => s.id === id)?.rung;
        expect(rungOf("direct")).toBe(0);
        expect(rungOf("agent-loop")).toBe(1);
        expect(rungOf("subagents")).toBe(2);
        expect(rungOf("teams")).toBe(3);
        expect(rungOf("arena")).toBe(4);
    });
});

describe("unwired strategies", () => {
    const arena = strategyCatalog.find((s) => s.id === "arena") as ExecutionStrategy;

    it("never match a profile", () => {
        expect(arena.match({ description: "anything", complexity: "very-complex" })).toBeNull();
    });

    it("emit an explicit not-wired error if executed directly", async () => {
        const rt = fakeRuntime({ turns: [] });
        const events = await collect(arena.execute({ profile: { description: "x" }, runtime: rt }));
        expect(events[0]?.type).toBe("error");
        expect((events[0] as { error: { message: string } }).error.message).toContain("not wired");
        expect(events[1]?.type).toBe("done");
    });
});