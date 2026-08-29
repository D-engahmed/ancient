// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Event bus + store-bridge tests (infrastructure/events). 12 tests.

import { describe, expect, it } from "bun:test";

import type { ExecutionEvent } from "../storage/types";
import { MemoryEventBus } from "./bus";
import { createExecutionStoreBridge } from "./bridge";
import type { LifecycleEvent } from "./types";

function evt(
    executionId: string,
    type: ExecutionEvent["type"],
    seq: number,
): LifecycleEvent {
    return {
        id: `evt-${executionId}-${type}-${seq}`,
        executionId,
        seq,
        type,
        timestamp: new Date("2026-01-01T00:00:00Z"),
    };
}

describe("MemoryEventBus", () => {
    it("delivers published events to subscribed listeners", () => {
        const bus = new MemoryEventBus();
        const received: LifecycleEvent[] = [];
        bus.subscribe((e) => {
            received.push(e);
        });
        bus.publish(evt("x", "started", 1));
        bus.publish(evt("x", "completed", 2));
        expect(received.map((e) => e.type)).toEqual(["started", "completed"]);
    });

    it("filters by a type predicate", () => {
        const bus = new MemoryEventBus();
        const received: string[] = [];
        bus.subscribe((e) => {
            received.push(e.type);
        }, (e) => e.type === "completed");
        bus.publish(evt("x", "started", 1));
        bus.publish(evt("x", "completed", 2));
        expect(received).toEqual(["completed"]);
    });

    it("filters by executionId", () => {
        const bus = new MemoryEventBus();
        const received: string[] = [];
        bus.subscribe((e) => {
            received.push(e.executionId);
        }, (e) => e.executionId === "a");
        bus.publish(evt("a", "started", 1));
        bus.publish(evt("b", "started", 1));
        expect(received).toEqual(["a"]);
    });

    it("once() fires only the first matching event", () => {
        const bus = new MemoryEventBus();
        let fired = 0;
        bus.once(() => {
            fired += 1;
        });
        bus.publish(evt("x", "started", 1));
        bus.publish(evt("x", "completed", 2));
        expect(fired).toBe(1);
    });

    it("unsubscribe stops future delivery", () => {
        const bus = new MemoryEventBus();
        let fired = 0;
        const unsub = bus.subscribe(() => {
            fired += 1;
        });
        bus.publish(evt("x", "started", 1));
        unsub();
        bus.publish(evt("x", "completed", 2));
        expect(fired).toBe(1);
    });

    it("isolates a throwing listener from its peers", () => {
        const bus = new MemoryEventBus();
        const errors: unknown[] = [];
        bus.setErrorHandler((err) => errors.push(err));
        const received: string[] = [];
        bus.subscribe(() => {
            throw new Error("boom");
        });
        bus.subscribe((e) => {
            received.push(e.type);
        });
        bus.publish(evt("x", "started", 1));
        expect(errors).toHaveLength(1);
        expect(received).toEqual(["started"]);
    });

    it("fires listeners in subscription order", () => {
        const bus = new MemoryEventBus();
        const order: number[] = [];
        bus.subscribe(() => {
            order.push(1);
        });
        bus.subscribe(() => {
            order.push(2);
        });
        bus.subscribe(() => {
            order.push(3);
        });
        bus.publish(evt("x", "started", 1));
        expect(order).toEqual([1, 2, 3]);
    });

    it("close() stops all delivery and prevents new subscriptions", () => {
        const bus = new MemoryEventBus();
        let fired = 0;
        bus.subscribe(() => {
            fired += 1;
        });
        bus.close();
        bus.publish(evt("x", "started", 1));
        expect(fired).toBe(0);
        expect(bus.closed).toBe(true);
        expect(() => bus.subscribe(() => {})).toThrow("closed");
    });

    it("reports listenerCount including active once queues", () => {
        const bus = new MemoryEventBus();
        bus.subscribe(() => {});
        bus.once(() => {});
        expect(bus.listenerCount).toBe(2);
        bus.publish(evt("x", "started", 1)); // once fires + removed
        expect(bus.listenerCount).toBe(1);
    });
});

describe("createExecutionStoreBridge", () => {
    it("forwards durable log events onto the bus and counts them", () => {
        const bus = new MemoryEventBus();
        /* eslint-disable @typescript-eslint/no-explicit-any */
        type Handler = (e: LifecycleEvent) => void;
        const sources: Handler[] = [];
        const bridge = createExecutionStoreBridge((onEvent) => {
            sources.push(onEvent);
            return () => {
                sources.length = 0;
            };
        }, bus);

        const received: string[] = [];
        bus.subscribe((e) => {
            received.push(e.type);
        });

        expect(bridge.active).toBe(false);
        bridge.start();
        expect(bridge.active).toBe(true);

        // Simulate the durable store appending events.
        sources.forEach((h) => h(evt("x", "started", 1)));
        sources.forEach((h) => h(evt("x", "completed", 2)));

        expect(received).toEqual(["started", "completed"]);
        expect(bridge.forwarded).toBe(2);

        bridge.stop();
        expect(bridge.active).toBe(false);
        expect(bridge.forwarded).toBe(0);
        /* eslint-enable @typescript-eslint/no-explicit-any */
    });
});
