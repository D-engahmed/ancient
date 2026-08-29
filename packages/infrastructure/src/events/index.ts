// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Cross-layer lifecycle event bus (infrastructure/events).
//
// Live pub-sub over lifecycle events, distinct from the durable log in
// infrastructure/storage. This is the real-time notification ring that lets the
// engine, strategies, and gateway react to execution progress without polling
// (A-LAYER-002 cross-layer comms).

export * from "./types";
export * from "./bus";
export * from "./bridge";
