// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// PostgreSQL-backed durable execution store.
//
// Sequence allocation is serialized per execution inside a transaction using a
// PostgreSQL advisory transaction lock. Counting outside the transaction was
// racy: two concurrent writers could both select the same sequence number.

import type {
  CheckpointRecord,
  ExecutionEvent,
  ExecutionRecord,
  ExecutionStore,
} from "@ANCIENT/infrastructure/storage";
import { applyEvent } from "@ANCIENT/infrastructure/storage";
import type { Prisma } from "../generated/prisma/index.js";
import { db } from "./client";

function asJson(value: Readonly<Record<string, unknown>>): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

const KNOWN_TYPES = new Set<string>([
  "created", "started", "queued", "waiting_approval", "plan-updated", "tool-executed", "artifact-created",
  "checkpoint-saved", "paused", "resumed", "retrying", "degraded",
  "completed", "failed", "cancelled",
]);

function toRecord(row: {
  id: string;
  executionId: string;
  userId: string | null;
  seq: number;
  type: string;
  timestamp: Date;
  payload: unknown;
}): ExecutionEvent {
  return {
    id: row.id,
    executionId: row.executionId,
    ...(row.userId ? { userId: row.userId } : {}),
    seq: row.seq,
    type: row.type as ExecutionEvent["type"],
    timestamp: row.timestamp,
    payload: (row.payload ?? undefined) as ExecutionEvent["payload"],
  };
}

export class PostgresExecutionStore implements ExecutionStore {
  async appendEvent(input: Omit<ExecutionEvent, "seq">): Promise<ExecutionEvent> {
    if (!KNOWN_TYPES.has(input.type)) {
      throw new Error(`PostgresExecutionStore: unknown lifecycle type '${input.type}'`);
    }

    return db.$transaction(async (tx) => {
      // One transaction-scoped advisory lock serializes sequence allocation for
      // this execution while allowing unrelated executions to append concurrently.
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${input.executionId}, 0))
      `;

      const count = await tx.executionEvent.count({
        where: { executionId: input.executionId },
      });
      const event: ExecutionEvent = {
        id: input.id ?? crypto.randomUUID(),
        executionId: input.executionId,
        seq: count + 1,
        userId: input.userId,
        type: input.type,
        timestamp: input.timestamp ?? new Date(),
        payload: input.payload,
      };

      await tx.executionEvent.create({
        data: {
          id: event.id,
          executionId: event.executionId,
          ...(event.userId ? { userId: event.userId } : {}),
          seq: event.seq,
          type: event.type,
          timestamp: event.timestamp,
          ...(event.payload ? { payload: asJson(event.payload) } : {}),
        },
      });
      return event;
    }, { timeout: 30_000 });
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
    const ids = await db.executionEvent.findMany({
      select: { executionId: true },
      distinct: ["executionId"],
      orderBy: { executionId: "asc" },
    });
    const records: ExecutionRecord[] = [];
    for (const { executionId } of ids.slice(0, 100)) {
      const record = await this.getExecution(executionId);
      if (record) records.push(record);
    }
    return records.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  }

  async listExecutionsForUser(userId: string, limit = 100): Promise<ExecutionRecord[]> {
    const heads = await db.executionEvent.findMany({
      where: { userId, type: "created" },
      select: { executionId: true },
      orderBy: { timestamp: "desc" },
      take: limit,
    });
    const records = await Promise.all(
      heads.map(({ executionId }) => this.getExecution(executionId)),
    );
    return records.filter((record): record is ExecutionRecord => record !== undefined && record.userId === userId).sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  }

  async listEvents(executionId: string): Promise<ExecutionEvent[]> {
    const rows = await db.executionEvent.findMany({
      where: { executionId },
      orderBy: { seq: "asc" },
    });
    return rows.map(toRecord);
  }

  async saveCheckpoint(checkpoint: CheckpointRecord): Promise<void> {
    await db.executionCheckpoint.upsert({
      where: { executionId_seq: { executionId: checkpoint.executionId, seq: checkpoint.seq } },
      create: {
        id: checkpoint.id,
        executionId: checkpoint.executionId,
        timestamp: checkpoint.timestamp,
        seq: checkpoint.seq,
        reason: checkpoint.reason,
        snapshot: asJson(checkpoint.snapshot),
      },
      update: {
        timestamp: checkpoint.timestamp,
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
      snapshot: row.snapshot as CheckpointRecord["snapshot"],
    };
  }
}
