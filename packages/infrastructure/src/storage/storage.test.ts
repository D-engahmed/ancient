// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.

import { describe, expect, it } from "bun:test";
import { EventSourcedExecutionStore, applyEvent, type ExecutionStore } from "./store";
import { shouldCheckpoint, type CheckpointPolicy } from "./checkpoints";
import type { ExecutionEvent } from "./types";

function evt(overrides: Partial<Omit<ExecutionEvent, "seq">> & { type: ExecutionEvent["type"]; executionId: string }): Omit<ExecutionEvent, "seq"> {
    return {
        id: overrides.id ?? `evt-${overrides.executionId}-${overrides.type}`,
        executionId: overrides.executionId,
        type: overrides.type,
        timestamp: overrides.timestamp ?? new Date("2026-01-01T00:00:00Z"),
        payload: overrides.payload,
    };
}

describe("EventSourcedExecutionStore", () => {
    it("replays events into a projection via applyEvent", async () => {
        const store: ExecutionStore = new EventSourcedExecutionStore();
        const execId = "exec-1";
        store.appendEvent(evt({ id: "e1", executionId: execId, type: "created", payload: { teamId: "t", teamName: "Team", task: "Build" } }));
        store.appendEvent(evt({ id: "e2", executionId: execId, type: "started" }));
        store.appendEvent(evt({ id: "e3", executionId: execId, type: "tool-executed", payload: { tokensIn: 100, tokensOut: 50, costUsd: 0.01 } }));

        const rec = await store.getExecution(execId);
        expect(rec).toBeDefined();
        expect(rec!.status).toBe("running");
        expect(rec!.teamName).toBe("Team");
        expect(rec!.tokensIn).toBe(100);
        expect(rec!.tokensOut).toBe(50);
        expect(rec!.lastSeq).toBe(2);
    });

    it("completes and captures output", async () => {
        const store: ExecutionStore = new EventSourcedExecutionStore();
        const execId = "exec-2";
        store.appendEvent(evt({ executionId: execId, type: "created" }));
        store.appendEvent(evt({ executionId: execId, type: "completed", payload: { output: "done!" } }));
        const rec = await store.getExecution(execId);
        expect(rec!.status).toBe("completed");
        expect(rec!.output).toBe("done!");
        expect(rec!.completedAt).toBeInstanceOf(Date);
    });

    it("accumulates cost across tool-executed events", async () => {
        const store: ExecutionStore = new EventSourcedExecutionStore();
        const execId = "exec-3";
        store.appendEvent(evt({ executionId: execId, type: "created" }));
        store.appendEvent(evt({ executionId: execId, type: "tool-executed", payload: { costUsd: 0.02 } }));
        store.appendEvent(evt({ executionId: execId, type: "tool-executed", payload: { costUsd: 0.03 } }));
        expect((await store.getExecution(execId))!.costUsd).toBeCloseTo(0.05);
    });

    it("lists executions newest-first", async () => {
        const store: ExecutionStore = new EventSourcedExecutionStore();
        for (const [id, date] of [["a", "2026-01-01T00:00:00Z"], ["b", "2026-01-02T00:00:00Z"]] as const) {
            store.appendEvent(evt({ executionId: id, type: "created", timestamp: new Date(date) }));
            store.appendEvent(evt({ executionId: id, type: "started", timestamp: new Date(date) }));
        }
        const list = await store.listExecutions();
        expect(list.map((r) => r.id)).toEqual(["b", "a"]);
    });

    it("persists and returns a checkpoint", async () => {
        const store: ExecutionStore = new EventSourcedExecutionStore();
        await store.saveCheckpoint({
            id: "cp-1",
            executionId: "exec-4",
            timestamp: new Date(),
            seq: 3,
            reason: "test",
            snapshot: { file: "src/x.ts" },
        });
        const cp = await store.getCheckpoint("exec-4");
        expect(cp?.id).toBe("cp-1");
    });
});

describe("applyEvent", () => {
    it("pauses then resumes", () => {
        let rec = applyEvent(undefined, {
            id: "1", executionId: "x", seq: 0, type: "created", timestamp: new Date(),
        });
        rec = applyEvent(rec, { id: "2", executionId: "x", seq: 1, type: "started", timestamp: new Date() });
        rec = applyEvent(rec, { id: "3", executionId: "x", seq: 2, type: "paused", timestamp: new Date() });
        expect(rec.status).toBe("paused");
        rec = applyEvent(rec, { id: "4", executionId: "x", seq: 3, type: "resumed", timestamp: new Date() });
        expect(rec.status).toBe("running");
    });
});

describe("shouldCheckpoint", () => {
    const base = new Date("2026-01-01T00:00:00Z");
    const policy: CheckpointPolicy = { everyNSeqs: 5, alwaysOnTypes: ["completed", "failed", "paused"] };

    it("checkpoints on always-on types", () => {
        expect(shouldCheckpoint({ type: "completed", seq: 0, timestamp: base }, undefined, policy).should).toBe(true);
    });
    it("skips until the seq counter interval is reached", () => {
        expect(shouldCheckpoint({ type: "tool-executed", seq: 2, timestamp: base }, { seq: 0, timestamp: base }, policy).should).toBe(false);
        expect(shouldCheckpoint({ type: "tool-executed", seq: 5, timestamp: base }, { seq: 0, timestamp: base }, policy).should).toBe(true);
    });
    it("respects the min interval", () => {
        const intervalPolicy: CheckpointPolicy = { minIntervalMs: 1000 };
        const t0 = new Date("2026-01-01T00:00:00Z");
        const t1 = new Date("2026-01-01T00:00:00.500Z");
        expect(shouldCheckpoint({ type: "tool-executed", seq: 10, timestamp: t1 }, { seq: 1, timestamp: t0 }, intervalPolicy).should).toBe(false);
    });
});
