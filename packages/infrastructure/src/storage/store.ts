// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Execution store + event-sourced projection (infrastructure).
//
// The ExecutionStore interface is the seam every layer relies on for durable
// execution state. The only implementation shipped here,
// EventSourcedExecutionStore, is an in-memory, append-only, replayable store
// that embodies "the event stream is the source of truth" from
// EXECUTION-STATE.md. A database-backed implementation (Postgres via Prisma)
// can later implement the same interface without touching callers.

import type { CheckpointRecord, ExecutionEvent, ExecutionRecord } from "./types";

/** Append-only contract for durable execution state. */
export interface ExecutionStore {
    /** Append a lifecycle event (assigns its seq). Mutates nothing visible
     * before the projection is re-read. */
    appendEvent(input: Omit<ExecutionEvent, "seq">): Promise<ExecutionEvent>;
    /** Current projected execution record, or undefined if never seen. */
    getExecution(executionId: string): Promise<ExecutionRecord | undefined>;
    /** Return all executions sorted by startedAt desc. */
    listExecutions(): Promise<ExecutionRecord[]>;
    /** All events for an execution, in seq order. */
    listEvents(executionId: string): Promise<ExecutionEvent[]>;
    /** Persist a durable checkpoint snapshot. */
    saveCheckpoint(checkpoint: CheckpointRecord): Promise<void>;
    /** Latest checkpoint for an execution, if any. */
    getCheckpoint(executionId: string): Promise<CheckpointRecord | undefined>;
}

/** Build a base (empty) execution record for a created execution. */
function baseRecord(id: string, teamId: string, teamName: string, task: string): ExecutionRecord {
    return {
        id,
        status: "pending",
        teamId,
        teamName,
        task,
        startedAt: new Date(),
        lastSeq: -1,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
    };
}

/** Pure reducer: apply one lifecycle event onto a record, returning the next. */
export function applyEvent(record: ExecutionRecord | undefined, event: ExecutionEvent): ExecutionRecord {
    const base = record ?? baseRecord(
        event.executionId,
        (event.payload?.teamId as string) ?? "",
        (event.payload?.teamName as string) ?? "",
        (event.payload?.task as string) ?? "",
    );
    const next: ExecutionRecord = { ...base, lastSeq: event.seq };

    const p = event.payload;
    switch (event.type) {
        case "created":
            next.status = "pending";
            if (typeof p?.teamId === "string") next.teamId = p.teamId;
            if (typeof p?.teamName === "string") next.teamName = p.teamName;
            if (typeof p?.task === "string") next.task = p.task;
            break;
        case "started":
            next.status = "running";
            next.startedAt = event.timestamp;
            break;
        case "plan-updated":
        case "tool-executed":
            if (typeof p?.tokensIn === "number") next.tokensIn += p.tokensIn;
            if (typeof p?.tokensOut === "number") next.tokensOut += p.tokensOut;
            if (typeof p?.costUsd === "number") next.costUsd += p.costUsd;
            break;
        case "checkpoint-saved":
            break;
        case "paused":
            next.status = "paused";
            break;
        case "resumed":
            next.status = "running";
            break;
        case "completed":
            next.status = "completed";
            next.completedAt = event.timestamp;
            if (typeof p?.output === "string") next.output = p.output;
            break;
        case "failed":
            next.status = "failed";
            next.completedAt = event.timestamp;
            if (typeof p?.error === "string") next.error = p.error;
            break;
    }
    return next;
}

/** In-memory, append-only, event-sourced execution store. Not durable across
 * process restarts — it is a reference implementation of the projection; the
 * durable backend replaces the maps with a DB implementation. */
export class EventSourcedExecutionStore implements ExecutionStore {
    private readonly events = new Map<string, ExecutionEvent[]>();
    private readonly byExecutionId = new Map<string, Map<string, ExecutionEvent>>();
    private readonly checkpoints = new Map<string, CheckpointRecord>();
    private nextId = 0;

    private nextEventId(): string {
        return `evt-${++this.nextId}`;
    }

    async appendEvent(input: Omit<ExecutionEvent, "seq">): Promise<ExecutionEvent> {
        const list = this.events.get(input.executionId) ?? [];
        const seq = list.length;
        const event: ExecutionEvent = { ...input, id: input.id ?? this.nextEventId(), seq, timestamp: input.timestamp ?? new Date() };
        list.push(event);
        this.events.set(input.executionId, list);
        this.byExecutionId.get(input.executionId) ?? this.byExecutionId.set(input.executionId, new Map());
        this.byExecutionId.get(input.executionId)!.set(event.id, event);
        return event;
    }

    async getExecution(executionId: string): Promise<ExecutionRecord | undefined> {
        const list = this.events.get(executionId);
        if (!list || list.length === 0) return undefined;
        return list.reduce(applyEvent, undefined as ExecutionRecord | undefined);
    }

    async listExecutions(): Promise<ExecutionRecord[]> {
        const seen = new Set<string>();
        const sorted: ExecutionRecord[] = [];
        for (const [executionId, list] of this.events) {
            if (list.length === 0 || seen.has(executionId)) continue;
            seen.add(executionId);
            sorted.push(list.reduce(applyEvent, undefined as ExecutionRecord | undefined)!);
        }
        return sorted.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
    }

    async listEvents(executionId: string): Promise<ExecutionEvent[]> {
        return this.events.get(executionId) ?? [];
    }

    async saveCheckpoint(checkpoint: CheckpointRecord): Promise<void> {
        this.checkpoints.set(checkpoint.executionId, checkpoint);
    }

    async getCheckpoint(executionId: string): Promise<CheckpointRecord | undefined> {
        return this.checkpoints.get(executionId);
    }
}
