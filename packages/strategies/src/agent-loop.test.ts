// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Agent-loop strategy tests (strategies) — rung 1 against a fake runtime.

import { describe, expect, it } from "bun:test";
import { collect } from "./test-collect";
import { call, fakeRuntime, turn } from "./test-fakes";
import { agentLoopStrategy } from "./agent-loop";

const task = { description: "port the helper", complexity: "moderate" as const };

describe("agent-loop strategy", () => {
    it("ends on the first turn with no tool calls", async () => {
        const rt = fakeRuntime({ turns: [turn("all done")] });
        const events = await collect(agentLoopStrategy.execute({ profile: task, runtime: rt }));
        const done = events.find((e) => e.type === "done");
        expect(done).toMatchObject({ turnCount: 1, toolCount: 0 });
        expect(rt.calls).toHaveLength(0);
    });

    it("keeps looping while the model requests tools", async () => {
        const rt = fakeRuntime({
            turns: [
                turn("look", [call("glob", { pattern: "**/*.ts" })]),
                turn("edit", [call("editFile", { path: "a.ts", oldString: "x", newString: "y" })]),
                turn("verified"),
            ],
        });
        const events = await collect(agentLoopStrategy.execute({ profile: task, runtime: rt }));
        expect(events.filter((e) => e.type === "tool-call")).toHaveLength(2);
        expect(events.filter((e) => e.type === "tool-result")).toHaveLength(2);
        const done = events.find((e) => e.type === "done");
        expect(done).toMatchObject({ turnCount: 3, toolCount: 2 });
        const usage = (done as { usage: { inputTokens: number } }).usage;
        expect(usage.inputTokens).toBe(30); // 3 turns x 10
    });

    it("turns a tool failure into a tool-result error event, not a crash", async () => {
        const rt = fakeRuntime({
            turns: [turn("boom", [call("writeFile", { path: "/", content: "x" })]), turn("recovered")],
            exec: () => {
                throw new Error("denied by policy");
            },
        });
        const events = await collect(agentLoopStrategy.execute({ profile: task, runtime: rt }));
        const bad = events.find((e) => e.type === "tool-result");
        expect(bad).toMatchObject({ error: "error: denied by policy" });
        expect((bad as { result: string }).result).toContain("denied");
        expect(events.some((e) => e.type === "done")).toBe(true);
    });

    it("emits an error event when the turn budget runs dry", async () => {
        const forever = () => turn("still going", [call("glob", { pattern: "*" })]);
        const rt = fakeRuntime({ turns: Array.from({ length: 20 }, forever) });
        const events = await collect(agentLoopStrategy.execute({ profile: task, runtime: rt }));
        expect(events.some((e) => e.type === "error" && (e as { message: string }).message.includes("max turns"))).toBe(true);
        const done = events.find((e) => e.type === "done");
        expect((done as { turnCount: number }).turnCount).toBe(10);
    });

    it("surfaces runtime model failures without throwing", async () => {
        const rt = fakeRuntime({ turns: [], failOnRun: true });
        const events = await collect(agentLoopStrategy.execute({ profile: task, runtime: rt }));
        expect(events.some((e) => e.type === "error")).toBe(true);
        expect(events.at(-1)?.type).toBe("done");
    });
});