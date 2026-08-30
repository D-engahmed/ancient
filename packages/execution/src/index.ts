// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Unified execution engine (engine) — the trunk of the layered product
// (ARCHITECTURE.md §4). Per A-LAYER-002 this package may import the layers below
// it (capabilities, strategies, infrastructure, shared) and never a layer above.
// The engine turns a task into an execution: infer → select → drive the strategy
// stream over a StrategyRuntime (capability registry + model chat port), with
// lifecycle, cancellation, and observability on the infra event bus.

export { ExecutionEngine, EngineSession } from "./engine";
export { createStrategyRuntime } from "./runtime";
export type { EngineRuntimeOptions } from "./runtime";
export { inferProfile, tierFromScore, estimateTokens, detectParallelizable, detectRequiredTools } from "./profiler";
export { createAiModelChat } from "./model";
export * from "./types";