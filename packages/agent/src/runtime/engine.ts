/**
 * Execution Engine
 * 
 * The heart of the runtime. Manages execution lifecycle, checkpointing,
 * and coordinates between arena, tasks, and backends.
 */

import type { TeamConfig, ExecutionState, TaskResult } from "../types";
import { ArenaCoordinator } from "../arena/coordinator";
import { AgentExecutor } from "./executor";
import { BackendRouter } from "../backends/router";
import { MessageBus } from "../arena/messaging";

// NOTE: ExecutionScheduler (./scheduler) is not wired in here. It's a
// cross-execution concurrency limiter (cap how many teams run at once
// across the whole engine) that was never implemented — runNext() finds a
// job and immediately no-ops. ArenaCoordinator already handles parallelism
// *within* one team's execution (e.g. Promise.all in runSwarm), so this
// engine works correctly without it for a single execution. If you need to
// cap concurrent executions across multiple teams, that's real, unwritten
// work — don't re-add the import as a decoration.

export class ExecutionEngine {
    private coordinator: ArenaCoordinator;
    private router: BackendRouter;
    private messageBus: MessageBus;

    constructor() {
        this.messageBus = new MessageBus();
        this.router = new BackendRouter();
        const executor = new AgentExecutor(this.router, this.messageBus);
        this.coordinator = new ArenaCoordinator(executor, this.messageBus);
    }

    async execute(team: TeamConfig, task: string): Promise<TaskResult> {
        return this.coordinator.execute(team, task);
    }

    /** See ArenaCoordinator.startExecution — returns the id before the run finishes. */
    startExecution(team: TeamConfig, task: string): { executionId: string; result: Promise<TaskResult> } {
        return this.coordinator.startExecution(team, task);
    }

    async executeWithStreaming(
        team: TeamConfig,
        task: string,
        onChunk: (chunk: string) => void
    ): Promise<TaskResult> {
        // Subscribe to message bus for streaming updates
        const unsubscribe = this.messageBus.subscribe("*", (event) => {
            if (event.type === "message:sent" && "message" in event) {
                onChunk(event.message.content);
            }
        });

        try {
            return await this.execute(team, task);
        } finally {
            unsubscribe();
        }
    }

    getExecutionStatus(executionId: string) {
        return this.coordinator.getExecutionStatus(executionId);
    }

    pauseExecution(executionId: string): boolean {
        return this.coordinator.pauseExecution(executionId);
    }

    resumeExecution(executionId: string): boolean {
        return this.coordinator.resumeExecution(executionId);
    }

    cancelExecution(executionId: string): boolean {
        return this.coordinator.cancelExecution(executionId);
    }

    getMessageBus(): MessageBus {
        return this.messageBus;
    }
}