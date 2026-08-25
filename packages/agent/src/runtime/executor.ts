/**
 * Agent Executor
 * 
 * Executes a single agent with its configured backend model.
 * Handles tool calling, streaming, fallback switching, and metrics.
 */

import type {
    AgentDefinition,
    ExecutionState,
    TaskResult,
    BackendConfig,
    ModelRoutingConfig,
} from "../types";
import { BackendRouter } from "../backends/router";
import { MessageBus } from "../arena/messaging";

export interface ExecutionOptions {
    expectJson?: boolean;
    jsonSchema?: Record<string, unknown>;
    timeoutMs?: number;
    maxRetries?: number;
    /** Lets a caller (ArenaCoordinator.cancelExecution) actually abort an in-flight model call. */
    abortSignal?: AbortSignal;
}

export class AgentExecutor {
    private router: BackendRouter;
    private messageBus: MessageBus;

    constructor(router: BackendRouter, messageBus: MessageBus) {
        this.router = router;
        this.messageBus = messageBus;
    }

    async run(
        agent: AgentDefinition,
        prompt: string,
        execution: ExecutionState,
        options: ExecutionOptions = {}
    ): Promise<TaskResult> {
        const startTime = Date.now();
        let retries = 0;
        const maxRetries = options.maxRetries ?? 3;

        this.messageBus.publish({
            type: "agent:started",
            agentId: agent.id || "",
            executionId: execution.id,
        });

        while (retries <= maxRetries) {
            try {
                const routingConfig: ModelRoutingConfig = {
                    agentId: agent.id!,
                    primary: agent.backend,
                    fallbacks: agent.fallbackBackends,
                    routingRules: [],
                };

                const result = await this.router.execute(routingConfig, prompt, {
                    expectJson: options.expectJson,
                    jsonSchema: options.jsonSchema,
                    timeoutMs: options.timeoutMs || agent.backend.timeoutMs,
                    tools: agent.tools,
                    abortSignal: options.abortSignal,
                });

                const latencyMs = Date.now() - startTime;

                this.messageBus.publish({
                    type: "agent:completed",
                    agentId: agent.id || "",
                    result: {
                        success: true,
                        output: result.text,
                        artifacts: [],
                        metrics: {
                            tokensIn: result.usage?.promptTokens || 0,
                            tokensOut: result.usage?.completionTokens || 0,
                            latencyMs,
                            costUsd: result.cost || 0,
                            toolCalls: result.toolCalls || 0,
                            retries,
                        },
                    },
                });

                return {
                    success: true,
                    output: result.text,
                    artifacts: [],
                    metrics: {
                        tokensIn: result.usage?.promptTokens || 0,
                        tokensOut: result.usage?.completionTokens || 0,
                        latencyMs,
                        costUsd: result.cost || 0,
                        toolCalls: result.toolCalls || 0,
                        retries,
                    },
                };
            } catch (error) {
                retries++;

                if (options.abortSignal?.aborted || retries > maxRetries) {
                    this.messageBus.publish({
                        type: "agent:error",
                        agentId: agent.id || "",
                        error: error as Error,
                    });

                    return {
                        success: false,
                        output: "",
                        artifacts: [],
                        metrics: {
                            tokensIn: 0,
                            tokensOut: 0,
                            latencyMs: Date.now() - startTime,
                            costUsd: 0,
                            toolCalls: 0,
                            retries,
                        },
                        error: (error as Error).message,
                    };
                }

                // Wait before retry
                await new Promise(r => setTimeout(r, 1000 * retries));
            }
        }

        throw new Error("Unreachable");
    }
}