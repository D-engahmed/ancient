/**
 * Message Bus
 *
 * Typed pub/sub for arena events (agent lifecycle, execution lifecycle,
 * streamed messages). runtime/executor.ts and runtime/engine.ts both
 * imported this from "../arena/messaging" — the module didn't exist.
 *
 * subscribe("*", handler) matches every event, same as engine.ts's
 * executeWithStreaming() already assumes. subscribe("agent:completed", ...)
 * matches only that event type.
 */

import { EventEmitter } from "eventemitter3";
import type { ArenaEvent } from "../types";

export type ArenaEventType = ArenaEvent["type"] | "*";
export type ArenaEventHandler = (event: ArenaEvent) => void;

export class MessageBus {
    private emitter = new EventEmitter();

    publish(event: ArenaEvent): void {
        // event.type is always one of the concrete ArenaEvent variants, never
        // "*" — so this always re-emits on the wildcard channel too. The old
        // `!== "*"` guard here could never be false; TS correctly flagged it
        // as a comparison with no overlap.
        this.emitter.emit(event.type, event);
        this.emitter.emit("*", event);
    }

    /** Returns an unsubscribe function. */
    subscribe(pattern: ArenaEventType, handler: ArenaEventHandler): () => void {
        this.emitter.on(pattern, handler);
        return () => this.emitter.off(pattern, handler);
    }

    /** Number of active listeners for a given pattern — mainly for tests. */
    listenerCount(pattern: ArenaEventType): number {
        return this.emitter.listenerCount(pattern);
    }

    removeAllListeners(): void {
        this.emitter.removeAllListeners();
    }
}
