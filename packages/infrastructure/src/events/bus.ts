// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Event bus implementation (infrastructure/events).
//
// A synchronous, in-order, in-process pub-sub bus. Design goals:
//   - ordering — listeners fire in subscription order, per published event;
//   - error isolation — a throwing listener is reported to the error handler and
//     does not prevent peers from receiving the event;
//   - filtering — subscribe optionally scoped to an executionId or a type predicate;
//   - once() — fire a single matching event then unsubscribe.

import type {
    BusErrorHandler,
    EventFilter,
    LifecycleEvent,
    Listener,
    Unsubscribe,
} from "./types";

/** A filter the bus short-circuits to NO-OP when none is provided. */
const always: EventFilter = () => true;

export type EventBus = {
    /** Register a listener; returns an unsubscribe handle. */
    subscribe(
        listener: Listener,
        filter?: EventFilter,
    ): Unsubscribe;
    /** Register a one-shot listener removed after its first matching event. */
    once(listener: Listener, filter?: EventFilter): Unsubscribe;
    /** Publish an event to all matching listeners. */
    publish(event: LifecycleEvent): void;
    /** True once close() has been called. */
    readonly closed: boolean;
    /** Stop delivery and clear all listeners. */
    close(): void;
    /** Number of currently-registered listeners (including queued once()). */
    readonly listenerCount: number;
    /** Set/clear the error handler invoked when a listener throws. */
    setErrorHandler(handler: BusErrorHandler | undefined): void;
};

type Entry = {
    listener: Listener;
    filter: EventFilter;
    once: boolean;
    active: boolean;
};

/** Reference implementation of {@link EventBus}. */
export class MemoryEventBus implements EventBus {
    #entries: Entry[] = [];
    #closed = false;
    #errorHandler: BusErrorHandler | undefined;

    constructor(errorHandler?: BusErrorHandler) {
        this.#errorHandler = errorHandler;
    }

    get closed(): boolean {
        return this.#closed;
    }

    get listenerCount(): number {
        return this.#entries.filter((e) => e.active).length;
    }

    setErrorHandler(handler: BusErrorHandler | undefined): void {
        this.#errorHandler = handler;
    }

    subscribe(listener: Listener, filter: EventFilter = always): Unsubscribe {
        return this.#add({ listener, filter, once: false, active: true });
    }

    once(listener: Listener, filter: EventFilter = always): Unsubscribe {
        return this.#add({ listener, filter, once: true, active: true });
    }

    publish(event: LifecycleEvent): void {
        if (this.#closed) return;
        // Copy so a listener that mutates the list mid-iteration is safe, and so
        // once() entries removed during this pass don't skip later peers.
        const snapshot = this.#entries.slice();
        for (const entry of snapshot) {
            if (!entry.active) continue;
            if (this.#closed) return;
            if (!entry.filter(event)) continue;
            if (entry.once) this.#remove(entry);
            try {
                const result = entry.listener(event);
                // Allow async listeners, but do not await — the bus is sync and
                // in-order by subscription; async work is the caller's concern.
                if (result && typeof (result as Promise<unknown>).then === "function") {
                    void result;
                }
            } catch (err) {
                this.#errorHandler?.(err, event);
            }
        }
    }

    close(): void {
        this.#closed = true;
        this.#entries = [];
        this.#errorHandler = undefined;
    }

    #add(entry: Entry): Unsubscribe {
        if (this.#closed) throw new Error("EventBus is closed");
        this.#entries.push(entry);
        return () => this.#remove(entry);
    }

    #remove(target: Entry): void {
        const idx = this.#entries.indexOf(target);
        if (idx === -1) return;
        target.active = false;
        this.#entries.splice(idx, 1);
    }
}
