// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Direct strategy tests (strategies) — rung 0 against a fake runtime.

import { describe, expect, it } from "bun:test";
import { collect } from "./test-collect";
import { call, fakeRuntime, turn } from "./test-fakes";
import { directStrategy } from "./direct";
import type { StrategyEvent } from "./types";

const task = { description: "write the README", complexity: "simple" as const };

describe("direct strategy", () => {
    it("completes a single-turn task with no tools", async () => {
        const rt = fakeRuntime({ turns: [turn("here is the README")] });
        const events = await collect(directStrategy.execute({ profile: task, runtime: rt }));

        expect(events[0]).toMatchObject({ type: "strategy-selected", id: "direct", rung: 0 });
        expect(events.filter((e) => e.type === "text-delta").map((e) => (e as { text: string }).text)).toEqual([
            "here is the README",
        ]);
        const done = events.find((e) => e.type === "done");
        expect(done).toMatchObject({ turnCount: 1, toolCount: 0 });
        expect(rt.calls).toHaveLength(0);
    });

    it("executes tool calls and lands a continuation", async () => {
        const rt = fakeRuntime({
            turns: [
                turn("reading the file", [call("readFile", { path: "x.md" })]),
                turn("done now"),
            ],
            exec: (c) => ({ readFile: "file content\n" })[c.name] ?? "ok",
        });
        const events = await collect(directStrategy.execute({ profile: task, runtime: rt }));
        const toolCalls = events.filter((e) => e.type === "tool-call");
        const toolResults = events.filter((e) => e.type === "tool-result");
        expect(toolCalls).toHaveLength(1);
        expect(toolResults).toHaveLength(1);
        const firstCall = toolCalls[0] as Extract<StrategyEvent, { type: "tool-call" }>;
        expect(toolResults[0]).toMatchObject({ callId: firstCall.call.id, result: "file content\n" });
        const done = events.find((e) => e.type === "done");
        expect(done).toMatchObject({ turnCount: 2, toolCount: 1 });
    });

    it("continues with a second tool pass if the model asks", async () => {
        const rt = fakeRuntime({
            turns: [
                turn("plan", [call("listDirectory")]),
                turn("checking", [call("grep", { pattern: "x" })]),
                turn("answer"),
            ],
        });
        const events = await collect(directStrategy.execute({ profile: task, runtime: rt }));
        expect(events.filter((e) => e.type === "tool-call")).toHaveLength(2);
        const done = events.find((e) => e.type === "done");
        expect(done).toMatchObject({ turnCount: 2, toolCount: 2 });
    });

    it("surfaces a model failure as an error event and still ends", async () => {
        const rt = fakeRuntime({ turns: [], failOnRun: true });
        const events = await collect(directStrategy.execute({ profile: task, runtime: rt }));
        expect(events.some((e) => e.type === "error" && (e as { message: string }).message.includes("model failure"))).toBe(true);
        expect(events.some((e) => e.type === "done")).toBe(true);
    });
});