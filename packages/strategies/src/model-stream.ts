// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Live model-turn streamer (strategies). Strategies drive `runtime.runModel`
// through this helper so partial text reaches the engine/CLI as it is
// generated instead of one batch after the whole turn settles.
//
// Flow: kick off `runModel` with an `onTextDelta` callback that feeds an async
// queue, drain that queue yielding each delta live, and produce the full
// `ModelTurnResult` once the call settles. The queue ends exactly when the
// model call settles, so the drain loop never spins and never outlives the
// turn.
//
// Backward compatible: a runtime that ignores `onTextDelta` (scripted test
// fakes) yields a single post-hoc delta holding the whole text — strategies
// keep their existing single-delta behavior and event shape.

import type { ModelTurnResult, StrategyRuntime } from "./types";

/** What a streamed model turn produces: live deltas, then the full result. */
export type ModelStreamPart =
    | { type: "delta"; text: string }
    | { type: "turn"; result: ModelTurnResult };

/** Async buffer bridging `onTextDelta` callbacks into the generator loop. */
class DeltaQueue {
    #items: string[] = [];
    #waiters: (() => void)[] = [];
    #ended = false;

    push(text: string): void {
        this.#items.push(text);
        this.#waiters.shift()?.();
    }

    end(): void {
        if (this.#ended) return;
        this.#ended = true;
        this.#waiters.shift()?.();
    }

    next(): Promise<IteratorResult<string>> {
        if (this.#items.length > 0) {
            return Promise.resolve({ done: false, value: this.#items.shift()! });
        }
        if (this.#ended) return Promise.resolve({ done: true, value: undefined });
        return new Promise<IteratorResult<string>>((resolve) => {
            this.#waiters.push(() => {
                if (this.#items.length > 0) resolve({ done: false, value: this.#items.shift()! });
                else resolve({ done: true, value: undefined });
            });
        });
    }
}

/**
 * Run one model turn, yielding each partial text chunk as it arrives and then
 * the full result. Rethrows the model call's failure after the queue drains,
 * so strategies keep their existing error classification path.
 */
export async function* streamModelTurn(
    runtime: StrategyRuntime,
    input: Parameters<StrategyRuntime["runModel"]>[0],
): AsyncGenerator<ModelStreamPart> {
    const queue = new DeltaQueue();
    const turnPromise = runtime.runModel({ ...input, onTextDelta: (text) => queue.push(text) });
    // Close the queue exactly when the call settles so the drain loop ends at
    // the right moment. The chained catch keeps the standalone `finally`
    // promise from being an unhandled rejection — the original rejection still
    // propagates through `turnPromise`.
    turnPromise.finally(() => queue.end()).catch(() => undefined);

    let emitted = "";
    while (true) {
        const next = await queue.next();
        if (next.done) break;
        emitted += next.value;
        yield { type: "delta", text: next.value };
    }

    const turn = await turnPromise;
    // Non-streaming port (ignores onTextDelta): fall back to one post-hoc delta.
    if (emitted.length === 0 && turn.text) {
        yield { type: "delta", text: turn.text };
    }
    yield { type: "turn", result: turn };
}