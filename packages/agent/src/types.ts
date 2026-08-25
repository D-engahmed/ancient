/**
 * Core Types — Multi-Agent Orchestration System
 *
 * Single source of truth for every type shared across arena/, team/,
 * tasks/, runtime/, and backends/.
 *
 * This file did not exist before this fix. Every other file in this
 * package imported from "../types" and none of it resolved — the
 * package could not type-check, let alone run.
 */

import type { SupportedProvider } from "@ANCIENT/shared";

// ---------------------------------------------------------------------------
// IDs
// ---------------------------------------------------------------------------

export type AgentId = string;
export type TaskId = string;
export type ExecutionId = string;

// ---------------------------------------------------------------------------
// Agent roles & capabilities
//
// These nine roles are the ones actually referenced by team/registry.ts's
// built-in templates and tasks/assigner.ts's scoring logic. The README
// claims "12 roles" — that number doesn't correspond to anything in the
// code, here or anywhere else in the repo. Add more roles in ROLE_DEFINITIONS
// (team/roles.ts) as real templates need them, rather than pre-declaring
// roles nothing uses yet.
// ---------------------------------------------------------------------------

export type AgentRole =
    | "coordinator"
    | "coder"
    | "reviewer"
    | "tester"
    | "architect"
    | "researcher"
    | "debugger"
    | "validator"
    | "documenter";

export type AgentCapability =
    | "code-generation"
    | "code-review"
    | "testing"
    | "architecture-design"
    | "debugging"
    | "research"
    | "documentation"
    | "planning";

// ---------------------------------------------------------------------------
// Backend / model routing
//
// BackendProvider extends @ANCIENT/shared's SupportedProvider with
// "openrouter", since team/registry.ts's built-in "swarm-coding" template
// already references an openrouter-hosted model. SupportedProvider doesn't
// include it upstream — that's a real gap in shared, not something to
// paper over here.
// ---------------------------------------------------------------------------

export type BackendProvider = SupportedProvider | "openrouter";

export interface BackendConfig {
    provider: BackendProvider;
    model: string;
    apiKey?: string;
    baseUrl?: string;
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
}

export interface ModelRoutingConfig {
    agentId: AgentId;
    primary: BackendConfig;
    fallbacks: BackendConfig[];
    routingRules: Array<{ condition: string; backend: BackendConfig }>;
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export interface AgentDefinition {
    id?: AgentId;
    name: string;
    role: AgentRole;
    description: string;
    systemPrompt: string;
    capabilities: AgentCapability[];
    tools: string[];
    backend: BackendConfig;
    fallbackBackends: BackendConfig[];
    maxDelegationDepth: number;
    parentId?: AgentId;
    canDelegateTo?: AgentId[];
}

export interface AgentRef {
    id: AgentId;
    name: string;
    role: AgentRole;
    model: string;
    provider: BackendProvider;
    capabilities: AgentCapability[];
    status: "idle" | "running" | "waiting" | "done" | "error";
    parentId?: AgentId;
    childrenIds?: AgentId[];
}

// ---------------------------------------------------------------------------
// Coordination protocols
//
// Five protocol types are actually referenced across builder.ts/registry.ts.
// The README claims "6 coordination protocols" — same kind of unverified
// number as the "12 roles" claim above.
// ---------------------------------------------------------------------------

export type ProtocolType = "hierarchical" | "pipeline" | "swarm" | "debate" | "round-robin";

export interface ProtocolConfig {
    type: ProtocolType;
    maxDepth?: number;
    pipelineOrder?: string[];
    agentCount?: number;
    consensusThreshold?: number;
    debateRounds?: number;
    maxTurns?: number;
    timeoutMs: number;
    streamIntermediate: boolean;
}

export interface FallbackStrategy {
    onModelFailure: "fallback-next" | "retry" | "fail";
    onTokenExceed: "summarize" | "truncate" | "fail";
    onTimeout: "fallback" | "retry" | "fail";
    maxRetries: number;
    retryDelayMs: number;
}

export interface TeamConfig {
    id: string;
    name: string;
    description: string;
    coordinatorId: AgentId;
    agents: AgentDefinition[];
    protocol: ProtocolConfig;
    maxParallelAgents: number;
    sharedContext: boolean;
    checkpointEnabled: boolean;
    fallbackStrategy: FallbackStrategy;
}

// ---------------------------------------------------------------------------
// Execution state & shared context
// ---------------------------------------------------------------------------

export interface Artifact {
    id: string;
    type: "file" | "diff" | "note" | "output";
    path?: string;
    content: string;
    createdBy: AgentId;
    createdAt: Date;
}

export interface SharedContext {
    executionId: ExecutionId;
    workingDirectory: string;
    files: Map<string, string>;
    memory: Map<string, unknown>;
    artifacts: Artifact[];
    constraints: string[];
    userPreferences: Record<string, unknown>;
}

export interface ExecutionState {
    id: ExecutionId;
    team: TeamConfig;
    task: string;
    status: "pending" | "running" | "paused" | "completed" | "failed" | "cancelled";
    context: SharedContext;
    startedAt: Date;
    completedAt?: Date;
}

// NOTE: this is a distinct concept from packages/server/src/checkpoints/store.ts.
// That one checkpoints server-side chat sessions; this one snapshots in-memory
// execution context for the orchestration engine. They do not share storage
// and nothing here writes to disk yet — see runtime/state.ts for the caveat.
export interface Checkpoint {
    id: string;
    timestamp: Date;
    agentId: AgentId;
    taskId: TaskId;
    contextSnapshot: SharedContext;
    reason: string;
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export type TaskStatus = "pending" | "in-progress" | "completed" | "failed" | "cancelled";
export type TaskPriority = "low" | "medium" | "high" | "critical";

export interface TaskResult {
    success: boolean;
    output: string;
    artifacts: Artifact[];
    metrics: {
        tokensIn: number;
        tokensOut: number;
        latencyMs: number;
        costUsd: number;
        toolCalls: number;
        retries: number;
    };
    error?: string;
}

// ---------------------------------------------------------------------------
// Message bus events
//
// The event union MessageBus actually needs to carry, inferred from every
// publish()/subscribe() call site in runtime/executor.ts and
// runtime/engine.ts. Neither file declared this type before — it doesn't
// exist elsewhere in the repo either.
// ---------------------------------------------------------------------------

export type ArenaEvent =
    | { type: "execution:started"; executionId: ExecutionId }
    | { type: "execution:paused"; executionId: ExecutionId }
    | { type: "execution:resumed"; executionId: ExecutionId }
    | { type: "execution:cancelled"; executionId: ExecutionId }
    | { type: "execution:completed"; executionId: ExecutionId; result: TaskResult }
    | { type: "agent:started"; agentId: AgentId; executionId: ExecutionId }
    | { type: "agent:completed"; agentId: AgentId; result: TaskResult }
    | { type: "agent:error"; agentId: AgentId; error: Error }
    | { type: "message:sent"; agentId: AgentId; message: { role: "assistant"; content: string } };

export interface SubTask {
    id: TaskId;
    parentId: TaskId | "";
    title: string;
    description: string;
    status: TaskStatus;
    priority?: TaskPriority;
    dependencies: TaskId[];
    dependents: TaskId[];
    estimatedTokens: number;
    actualTokens: number;
    createdAt: Date;
    startedAt?: Date;
    completedAt?: Date;
    result?: TaskResult;
}
