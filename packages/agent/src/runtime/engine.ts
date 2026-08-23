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
import { ExecutionScheduler } from "./scheduler";

export class ExecutionEngine {
    private coordinator: ArenaCoordinator;
    private scheduler: ExecutionScheduler;
    private router: BackendRouter;
    private messageBus: MessageBus;

    constructor() {
        this.messageBus = new MessageBus();
        this.router = new BackendRouter();
        const executor = new AgentExecutor(this.router, this.messageBus);
        this.coordinator = new ArenaCoordinator(executor, this.messageBus);
        this.scheduler = new ExecutionScheduler();
    }

    async execute(team: TeamConfig, task: string): Promise<TaskResult> {
        return this.coordinator.execute(team, task);
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