// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Subagents strategy tests (strategies) — rung 2 against a fake runtime.

import { describe, expect, it } from "bun:test";
import { collect } from "./test-collect";
import { call, fakeRuntime, turn } from "./test-fakes";
import { subagentsStrategy } from "./subagents";
import type { StrategyEvent } from "./types";

const task = { description: "refactor the monolith", complexity: "complex" as const };

type SubtaskEvent = Extract<StrategyEvent, { type: "subtask" }>;

describe("subagents strategy", () => {
    it("plans, then runs each subtask as a bounded loop", async () => {
        const rt = fakeRuntime({
            turns: [
                turn('```json\n{"subtasks":[{"goal":"split module A"},{"goal":"split module B"}]}\n```'),
                turn("A done"),
                turn("B done"),
            ],
        });
        const events = await collect(subagentsStrategy.execute({ profile: task, runtime: rt }));
        const created: SubtaskEvent[] = [];
        for (const e of events) if (e.type === "subtask" && e.status === "created") created.push(e);
        expect(created.map((e) => e.goal)).toEqual(["split module A", "split module B"]);
        expect(events.filter((e) => e.type === "subtask" && e.status === "completed")).toHaveLength(2);
        expect(events.filter((e) => e.type === "tool-call")).toHaveLength(0);
        const dDone = events.filter((e) => e.type === "done");
        const done = dDone[dDone.length - 1] as { summary?: string };
        expect(done).toBeDefined();
        expect(done.summary).toContain("2 subtask(s)");
    });

    it("delegates tool use to subtask loops", async () => {
        const rt = fakeRuntime({
            turns: [
                turn('{"subtasks":[{"goal":"inspect config"}]}'),
                turn("checking", [call("readFile", { path: "config.json" })]),
                turn("inspected"),
            ],
        });
        const events = await collect(subagentsStrategy.execute({ profile: task, runtime: rt }));
        expect(events.filter((e) => e.type === "tool-call")).toHaveLength(1);
        expect(rt.calls).toHaveLength(1);
        expect(rt.calls[0]?.name).toBe("readFile");
    });

    it("emits an error event when planning produces no subtasks", async () => {
        const rt = fakeRuntime({ turns: [turn("Sorry, I cannot decompose this.")] });
        const events = await collect(subagentsStrategy.execute({ profile: task, runtime: rt }));
        expect(events.some((e) => e.type === "error" && (e as { message: string }).message.includes("planning failed"))).toBe(true);
        expect(events.at(-1)?.type).toBe("done");
    });

    it("handles non-JSON planner output (code-fenced) and caps subtask count", async () => {
        const many = Array.from({ length: 20 }, (_, i) => ({ goal: `goal ${i}` }));
        const rt = fakeRuntime({
            turns: [
                turn(`\`\`\`json\n{"subtasks":${JSON.stringify(many)}}\n\`\`\``),
                ...many.map((_, i) => turn(`work ${i}`)),
            ],
        });
        const events = await collect(subagentsStrategy.execute({ profile: task, runtime: rt }));
        const created: SubtaskEvent[] = [];
        for (const e of events) if (e.type === "subtask" && e.status === "created") created.push(e);
        expect(created).toHaveLength(8); // MAX_SUBTASKS cap
        expect(events.at(-1)?.type).toBe("done");
    }, 20_000);
});