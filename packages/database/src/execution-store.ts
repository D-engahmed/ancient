// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Postgres-backed durable execution store (A-EXEC-003).
//
// Implements the infrastructure ExecutionStore seam over the two Prisma tables
// in schema.prisma (ExecutionEvent / ExecutionCheckpoint). Same append-only
// semantics as the in-memory reference (seq is the per-execution replay order,
// assigned by counting the execution's existing rows), so a caller can swap the
// in-memory store for this one without touching the projection logic. The
// payload is stored as JSON — the event stream stays provider-agnostic.

import type {
    CheckpointRecord,
    ExecutionEvent,
    ExecutionRecord,
    ExecutionStore,
} from "@ANCIENT/infrastructure/storage";
import { applyEvent } from "@ANCIENT/infrastructure/storage";
import type { Prisma } from "../generated/prisma/index.js";
import { db } from "./client";

/** Readonly payloads map to Prisma's Json input type (unknown values cast). */
function asJson(value: Readonly<Record<string, unknown>>): Prisma.InputJsonValue {
    return value as unknown as Prisma.InputJsonValue;
}

/** Lifecycle types the Prisma table stores as free text — validated here so a
 *  typo surfaces loudly at append time, not silently off the replay path. */
const KNOWN_TYPES = new Set<string>([
    "created",
    "started",
    "plan-updated",
    "tool-executed",
    "artifact-created",
    "checkpoint-saved",
    "paused",
    "resumed",
    "retrying",
    "degraded",
    "completed",
    "failed",
]);

function toRecord(row: {
    id: string;
    executionId: string;
    seq: number;
    type: string;
    timestamp: Date;
    payload: unknown;
}): ExecutionEvent {
    return {
        id: row.id,
        executionId: row.executionId,
        seq: row.seq,
        type: row.type as ExecutionEvent["type"],
        timestamp: row.timestamp,
        payload: (row.payload ?? undefined) as unknown as ExecutionEvent["payload"],
    };
}

export class PostgresExecutionStore implements ExecutionStore {
    async appendEvent(input: Omit<ExecutionEvent, "seq">): Promise<ExecutionEvent> {
        const type = input.type;
        if (!KNOWN_TYPES.has(type)) {
            throw new Error(`PostgresExecutionStore: unknown lifecycle type '${type}'`);
        }

        // seq = count of the execution's existing events (gapless 1-based, same
        // invariant the identity store uses; the DB unique(executionId, seq)
        // constraint guards the race mutants).
        const count = await db.executionEvent.count({ where: { executionId: input.executionId } });
        const seq = count;
        const event: ExecutionEvent = {
            id: input.id ?? crypto.randomUUID(),
            executionId: input.executionId,
            seq,
            type,
            timestamp: input.timestamp ?? new Date(),
            payload: input.payload,
        };

        await db.executionEvent.create({
            data: {
                id: event.id,
                executionId: event.executionId,
                seq: event.seq,
                type: event.type,
                timestamp: event.timestamp,
                ...(event.payload ? { payload: asJson(event.payload) } : {}),
            },
        });
        return event;
    }

    async getExecution(executionId: string): Promise<ExecutionRecord | undefined> {
        const rows = await db.executionEvent.findMany({
            where: { executionId },
            orderBy: { seq: "asc" },
        });
        if (rows.length === 0) return undefined;
        return rows.map(toRecord).reduce(applyEvent, undefined as ExecutionRecord | undefined);
    }

    async listExecutions(): Promise<ExecutionRecord[]> {
        // Distinct execution ids (event counts per execution are tiny), then a
        // light projection per execution — replay stays in shared applyEvent.
        const ids = await db.executionEvent.findMany({ select: { executionId: true }, distinct: ["executionId"] });
        const records: ExecutionRecord[] = [];
        for (const { executionId } of ids.slice(0, 100)) {
            const record = await this.getExecution(executionId);
            if (record) records.push(record);
        }
        return records.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
    }

    async listEvents(executionId: string): Promise<ExecutionEvent[]> {
        const rows = await db.executionEvent.findMany({
            where: { executionId },
            orderBy: { seq: "asc" },
        });
        return rows.map(toRecord);
    }

    async saveCheckpoint(checkpoint: CheckpointRecord): Promise<void> {
        await db.executionCheckpoint.create({
            data: {
                id: checkpoint.id,
                executionId: checkpoint.executionId,
                timestamp: checkpoint.timestamp,
                seq: checkpoint.seq,
                reason: checkpoint.reason,
                snapshot: asJson(checkpoint.snapshot),
            },
        });
    }

    async getCheckpoint(executionId: string): Promise<CheckpointRecord | undefined> {
        const row = await db.executionCheckpoint.findFirst({
            where: { executionId },
            orderBy: { seq: "desc" },
        });
        if (!row) return undefined;
        return {
            id: row.id,
            executionId: row.executionId,
            timestamp: row.timestamp,
            seq: row.seq,
            reason: row.reason,
            snapshot: row.snapshot as unknown as CheckpointRecord["snapshot"],
        };
    }
}