// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Checkpoint policy (infrastructure) — decides WHEN to take a durable snapshot
// of an execution so we never block a step on I/O unless a checkpoint is due
// (a decision recorded in EXECUTION-STATE.md).

export type CheckpointPolicy = {
    /** Emit a checkpoint every N lifecycle events (e.g. every 5 tool calls). */
    everyNSeqs?: number;
    /** Also checkpoint on these event types regardless of counter. */
    alwaysOnTypes?: ReadonlyArray<string>;
    /** Never take more than one checkpoint per interval (ms). */
    minIntervalMs?: number;
};

export const DEFAULT_CHECKPOINT_POLICY: CheckpointPolicy = {
    everyNSeqs: 5,
    alwaysOnTypes: ["paused", "completed", "failed"],
};

export type ShouldCheckpointResult = {
    should: boolean;
    reason: string;
};

/** Pure decision: should we checkpoint given the event just appended and the
 * last time we checkpointed? No I/O — callers persist when this returns true. */
export function shouldCheckpoint(
    event: { type: string; seq: number; timestamp: Date },
    lastCheckpoint: { seq: number; timestamp: Date } | undefined,
    policy: CheckpointPolicy,
): ShouldCheckpointResult {
    const { everyNSeqs, alwaysOnTypes, minIntervalMs } = {
        ...DEFAULT_CHECKPOINT_POLICY,
        ...policy,
    };

    if (alwaysOnTypes?.includes(event.type)) {
        return { should: true, reason: `checkpoint enqueued on '${event.type}'` };
    }

    const withinInterval = minIntervalMs
        ? lastCheckpoint && event.timestamp.getTime() - lastCheckpoint.timestamp.getTime() < minIntervalMs
        : false;
    if (withinInterval) {
        return { should: false, reason: "within min checkpoint interval" };
    }

    if (everyNSeqs && lastCheckpoint) {
        if (event.seq - lastCheckpoint.seq >= everyNSeqs) {
            return { should: true, reason: `every ${everyNSeqs} seq (${event.seq}) reached` };
        }
        return { should: false, reason: "counter not reached" };
    }

    if (everyNSeqs && !lastCheckpoint) {
        // First interval counts from seq 0; checkpoint when we reach everyNSeqs.
        return { should: event.seq + 1 >= everyNSeqs, reason: event.seq + 1 >= everyNSeqs ? "initial interval reached" : "initial counter not reached" };
    }

    return { should: false, reason: "no checkpoint trigger configured" };
}
