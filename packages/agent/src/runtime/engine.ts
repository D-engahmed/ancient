/**
 * Team Orchestrator (legacy multi-agent engine)
 *
 * Runs a team of agents through the ArenaCoordinator. Coordinates between
 * arena, tasks, and backends. Renamed from `ExecutionEngine` (CLI-V2 audit F9)
 * to remove the name collision with the unified execution engine in
 * @ANCIENT/execution; this remains the legacy team/arena orchestrator until
 * the strategies `teams`/`arena` leaves are wired.
 */

import type { TeamConfig, ExecutionState, TaskResult } from "../types";
import { ArenaCoordinator } from "../arena/coordinator";
import { AgentExecutor } from "./executor";
import { BackendRouter } from "../backends/router";
import { MessageBus } from "../arena/messaging";

// NOTE: ExecutionScheduler (./scheduler) is not wired in here. It's a
    // cross-execution concurrency limiter (cap how many teams run at once
    // across the whole orchestrator) that was never implemented — runNext()
    // finds a job and immediately no-ops. ArenaCoordinator already handles
    // parallelism *within* one team's execution (e.g. Promise.all in
    // runSwarm), so this orchestrator works correctly without it for a single
    // execution. If you need to cap concurrent executions across multiple
    // teams, that's real, unwritten work — don't re-add the import as a
    // decoration.

export class TeamOrchestrator {
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