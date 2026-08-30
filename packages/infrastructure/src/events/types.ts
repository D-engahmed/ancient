// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Cross-layer lifecycle event bus types (infrastructure).
//
// The storage sub-layer owns the DURABLE event log (ExecutionEvent in
// src/storage/types.ts). This events module owns the LIVE notification bus: real-time
// pub-sub over the same lifecycle events, so the engine, strategies, and gateway can
// react without polling a store. Per A-LAYER-002, cross-layer communication flows
// through this bus (one-directional, infra-owned).

import type { ExecutionEvent } from "../storage/types";

/**
 * The events the bus carries are lifecycle events from the durable store. We alias
 * here so callers downstream import from the events module, not storage directly.
 */
export type LifecycleEvent = ExecutionEvent;

/** The lifecycle event type union (synonym to the storage-layer type). */
export type { LifecycleEventType } from "../storage/types";

/** Events are published with their executionId for convenient correlation. */
export type BusContext = {
    executionId: string;
};

/** Predicate deciding whether a published event reaches a given listener. */
export type EventFilter = (event: LifecycleEvent) => boolean;

/** A listener receives each (matching) published event. May be async. */
export type Listener = (event: LifecycleEvent) => void | Promise<void>;

/** Handle returned by subscribe(); calling it removes the listener. */
export type Unsubscribe = () => void;

/**
 * Raised when a listener throws, so the publisher can report to an error handler
 * without breaking unaffected listeners (error isolation).
 */
export type BusErrorHandler = (err: unknown, event: LifecycleEvent) => void;

/** A durable log source the bus can be bridged to (see bridge.ts). */
export type LogSource = (
    onEvent: (event: ExecutionEvent) => void,
) => Unsubscribe;
