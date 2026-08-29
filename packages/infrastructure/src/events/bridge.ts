// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Durable-store -> live-bus bridge (infrastructure/events).
//
// The storage sub-layer keeps the append-only DURABLE log; the bus carries LIVE
// notifications. This bridge wires the two: every event appended to a durable
// source is re-published onto the EventBus so downstream layers react in real
// time instead of polling. Per A-LAYER-002 this is the cross-layer channel.
//
// The bridge stays decoupled from any concrete store by accepting a LogSource
// callback (see types.ts) rather than the store object — keeping this module
// dependency-light.

import type { EventBus } from "./bus";
import type { LogSource, LifecycleEvent, Unsubscribe } from "./types";

export type ExecutionStoreEventBridge = {
    /** Start forwarding events from the log source onto the bus. */
    start(): Unsubscribe;
    /** Active (started and not yet stopped). */
    readonly active: boolean;
    /** Count of forwarded events since start (or since last reset). */
    readonly forwarded: number;
    /** Stop forwarding and clear the counter. */
    stop(): void;
    reset(): void;
};

/** Create a bridge from a durable log source to a live {@link EventBus}. */
export function createExecutionStoreBridge(
    source: LogSource,
    bus: EventBus,
): ExecutionStoreEventBridge {
    let unsub: Unsubscribe | undefined;
    let count = 0;

    return {
        get active(): boolean {
            return unsub !== undefined;
        },
        get forwarded(): number {
            return count;
        },
        start(): Unsubscribe {
            if (unsub) return unsub;
            unsub = source((event: LifecycleEvent) => {
                bus.publish(event);
                count += 1;
            });
            return unsub;
        },
        stop(): void {
            unsub?.();
            unsub = undefined;
            count = 0;
        },
        reset(): void {
            count = 0;
        },
    };
}
