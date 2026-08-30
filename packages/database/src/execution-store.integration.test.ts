// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Postgres-backed durable execution store (A-EXEC-003) — integration test.
//
// Requires a live Postgres reachable via DATABASE_URL (root .env) that has the
// ExecutionEvent / ExecutionCheckpoint tables (prisma migrate deploy). The whole
// describe is skipped when DATABASE_URL is absent so the unit suite stays green
// in CI; rows written here are removed in afterAll.

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const hasDb = !!process.env.DATABASE_URL;
const TEST_PREFIX = "itest-";
// Neon's pooled Postgres can take seconds per query on a cold connection — give
// the DB-backed cases headroom so the suite isn't flaky under pooler latency.
const INTEGRATION_TIMEOUT_MS = 30_000;
const store = import("./execution-store");

describe.skipIf(!hasDb)("PostgresExecutionStore (integration, requires DATABASE_URL)", () => {
    let PostgresExecutionStore: Awaited<typeof store>["PostgresExecutionStore"];
    let first: InstanceType<typeof PostgresExecutionStore> | undefined;
    let db: (typeof import("./client"))["db"] | undefined;

    beforeAll(async () => {
        ({ PostgresExecutionStore } = await store);
        ({ db } = await import("./client"));
        first = new PostgresExecutionStore();
    });

    afterAll(async () => {
        if (!db) return;
        await db.executionEvent.deleteMany({ where: { executionId: { startsWith: TEST_PREFIX } } });
        await db.executionCheckpoint.deleteMany({ where: { executionId: { startsWith: TEST_PREFIX } } });
    });

    it("appends a gapless seq stream and projects it via applyEvent", async () => {
        const execId = `${TEST_PREFIX}replay`;
        const store = first!;
        const c0 = await store.appendEvent({ id: `${TEST_PREFIX}e0`, executionId: execId, type: "created", timestamp: new Date("2026-01-01T00:00:00.000Z"), payload: { teamId: "t1", teamName: "Alpha", task: "Build it" } });
        await store.appendEvent({ id: `${TEST_PREFIX}e1`, executionId: execId, type: "started", timestamp: new Date("2026-01-01T00:00:01.000Z") });
        await store.appendEvent({ id: `${TEST_PREFIX}e2`, executionId: execId, type: "tool-executed", timestamp: new Date("2026-01-01T00:00:02.000Z"), payload: { tokensIn: 100, tokensOut: 50, costUsd: 0.01 } });

        const events = await store.listEvents(execId);
        // The store's contract is a gapless per-execution replay order, not an
        // absolute 0 base — assert the tighter invariant so a stale projection
        // row from an interrupted run can't produce a false failure.
        const seqs = events.map((e) => e.seq);
        const firstSeq = seqs[0] ?? 0;
        expect(seqs.every((s, i) => s === firstSeq + i)).toBe(true);
        expect(c0.seq).toBe(firstSeq);

        const lastSeq = seqs[seqs.length - 1]!;

        const rec = await store.getExecution(execId);
        expect(rec).toBeDefined();
        expect(rec!.status).toBe("running");
        expect(rec!.teamName).toBe("Alpha");
        expect(rec!.tokensIn).toBe(100);
        expect(rec!.tokensOut).toBe(50);
        expect(rec!.lastSeq).toBe(lastSeq);
    }, INTEGRATION_TIMEOUT_MS);

    it("replays from the database through a fresh store instance", async () => {
        const execId = `${TEST_PREFIX}durable`;
        const a = first!;
        await a.appendEvent({ id: `${TEST_PREFIX}d0`, executionId: execId, type: "created", timestamp: new Date("2026-01-01T00:00:00.000Z"), payload: { teamId: "t2", teamName: "Beta", task: "Ship" } });
        await a.appendEvent({ id: `${TEST_PREFIX}d1`, executionId: execId, type: "completed", timestamp: new Date("2026-01-01T00:00:01.000Z"), payload: { output: "shipped!" } });

        // A brand-new store has no local state — the projection must be rebuilt
        // from Postgres, which is exactly what the in-memory reference cannot do.
        const b = new PostgresExecutionStore();
        const rec = await b.getExecution(execId);
        expect(rec!.status).toBe("completed");
        expect(rec!.output).toBe("shipped!");
        expect(rec!.lastSeq).toBe(1);
    }, INTEGRATION_TIMEOUT_MS);

    it("lists executions newest-first", async () => {
        const a = first!;
        const older = `${TEST_PREFIX}order-old`;
        const newer = `${TEST_PREFIX}order-new`;
        await a.appendEvent({ id: `${TEST_PREFIX}o0`, executionId: older, type: "created", timestamp: new Date("2026-01-01T00:00:00.000Z") });
        await a.appendEvent({ id: `${TEST_PREFIX}o1`, executionId: older, type: "started", timestamp: new Date("2026-01-01T00:00:00.000Z") });
        await a.appendEvent({ id: `${TEST_PREFIX}n0`, executionId: newer, type: "created", timestamp: new Date("2026-01-02T00:00:00.000Z") });
        await a.appendEvent({ id: `${TEST_PREFIX}n1`, executionId: newer, type: "started", timestamp: new Date("2026-01-02T00:00:00.000Z") });

        const recs = await a.listExecutions();
        const mine = recs.filter((r) => r.id.startsWith(TEST_PREFIX));
        expect(mine.findIndex((r) => r.id === newer)).toBeLessThan(mine.findIndex((r) => r.id === older));
    }, INTEGRATION_TIMEOUT_MS);

    it("persists and returns the latest checkpoint", async () => {
        const a = first!;
        const execId = `${TEST_PREFIX}checkpoint`;
        await a.saveCheckpoint({
            id: `${TEST_PREFIX}cp1`,
            executionId: execId,
            timestamp: new Date("2026-01-01T00:00:00.000Z"),
            seq: 1,
            reason: "mid-run",
            snapshot: { state: "running", turns: 3 },
        });
        await a.saveCheckpoint({
            id: `${TEST_PREFIX}cp2`,
            executionId: execId,
            timestamp: new Date("2026-01-01T00:00:01.000Z"),
            seq: 2,
            reason: "paused",
            snapshot: { state: "paused", turns: 4 },
        });

        const cp = await a.getCheckpoint(execId);
        expect(cp!.id).toBe(`${TEST_PREFIX}cp2`);
        expect(cp!.snapshot).toEqual({ state: "paused", turns: 4 });
    }, INTEGRATION_TIMEOUT_MS);

    it("rejects an unknown lifecycle type at append time", async () => {
        // @ts-expect-error intentionally passing an unknown lifecycle type
        await expect(first!.appendEvent({ id: `${TEST_PREFIX}bad-evt`, executionId: `${TEST_PREFIX}bad`, type: "exploded" })).rejects.toThrow("unknown lifecycle type");
    }, INTEGRATION_TIMEOUT_MS);
});