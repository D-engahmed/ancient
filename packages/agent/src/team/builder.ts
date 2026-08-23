/**
 * Team Builder — Fluent API for Designing Agent Teams
 * 
 * Usage:
 * const team = TeamBuilder.create("MyTeam")
 *   .withCoordinator("coordinator", { model: "gpt-4o", provider: "openai" })
 *   .addAgent("coder", { model: "claude-3-5-sonnet", role: "coder", reportsTo: "coordinator" })
 *   .addAgent("reviewer", { model: "gpt-4o-mini", role: "reviewer", reportsTo: "coordinator" })
 *   .useProtocol("hierarchical", { maxDepth: 3 })
 *   .withFallback({ onModelFailure: "fallback-next", maxRetries: 3 })
 *   .build();
 */

import type {
    AgentDefinition,
    TeamConfig,
    ProtocolType,
    ProtocolConfig,
    FallbackStrategy,
    BackendConfig,
    AgentRole,
} from "../types";
import {
    getRoleConfig,
    getDefaultSystemPrompt,
    getDefaultCapabilities,
    getDefaultTools,
    getPreferredModels,
} from "./roles";
import { v4 as uuidv4 } from "uuid";

export interface AgentBuilderConfig {
    name: string;
    role: AgentRole;
    model: string;
    provider: BackendConfig["provider"];
    apiKey?: string;
    baseUrl?: string;
    temperature?: number;
    maxTokens?: number;
    systemPrompt?: string;
    capabilities?: string[];
    tools?: string[];
    reportsTo?: string; // Agent name or ID
    maxDelegationDepth?: number;
    fallbackModels?: Array<{ model: string; provider: BackendConfig["provider"] }>;
}

export class TeamBuilder {
    private team: Partial<TeamConfig> = {};
    private agents: Map<string, AgentDefinition> = new Map();
    private coordinatorId?: string;
    private hierarchyEdges: Array<{ child: string; parent: string }> = [];

    static create(name: string, description?: string): TeamBuilder {
        const builder = new TeamBuilder();
        builder.team = {
            id: uuidv4(),
            name,
            description: description || `Team ${name}`,
            maxParallelAgents: 5,
            sharedContext: true,
            checkpointEnabled: true,
            fallbackStrategy: {
                onModelFailure: "fallback-next",
                onTokenExceed: "summarize",
                onTimeout: "fallback",
                maxRetries: 3,
                retryDelayMs: 1000,
            },
        };
        return builder;
    }

    /** Add the coordinator agent (required) */
    withCoordinator(name: string, config: Omit<AgentBuilderConfig, "role" | "reportsTo">): TeamBuilder {
        const id = uuidv4();
        const roleConfig = getRoleConfig("coordinator");

        const agent: AgentDefinition = {
            id,
            name,
            role: "coordinator",
            description: `Coordinator agent: ${name}`,
            systemPrompt: config.systemPrompt || roleConfig.defaultSystemPrompt,
            capabilities: (config.capabilities as any) || roleConfig.defaultCapabilities,
            tools: config.tools || roleConfig.defaultTools,
            backend: this.buildBackend(config),
            fallbackBackends: this.buildFallbacks(config),
            maxDelegationDepth: config.maxDelegationDepth || roleConfig.maxDelegationDepth,
            canDelegateTo: [],
        };

        this.agents.set(name, agent);
        this.coordinatorId = id;
        return this;
    }

    /** Add a specialist agent */
    addAgent(name: string, config: AgentBuilderConfig): TeamBuilder {
        const id = uuidv4();
        const roleConfig = getRoleConfig(config.role);

        const agent: AgentDefinition = {
            id,
            name,
            role: config.role,
            description: `${config.role} agent: ${name}`,
            systemPrompt: config.systemPrompt || roleConfig.defaultSystemPrompt,
            capabilities: (config.capabilities as any) || roleConfig.defaultCapabilities,
            tools: config.tools || roleConfig.defaultTools,
            backend: this.buildBackend(config),
            fallbackBackends: this.buildFallbacks(config),
            maxDelegationDepth: config.maxDelegationDepth || roleConfig.maxDelegationDepth,
            parentId: undefined,
            canDelegateTo: [],
        };

        this.agents.set(name, agent);

        if (config.reportsTo) {
            this.hierarchyEdges.push({ child: name, parent: config.reportsTo });
        }

        return this;
    }

    /** Set coordination protocol */
    useProtocol(type: ProtocolType, config?: Partial<ProtocolConfig>): TeamBuilder {
        this.team.protocol = {
            type,
            maxDepth: config?.maxDepth,
            pipelineOrder: config?.pipelineOrder,
            agentCount: config?.agentCount,
            consensusThreshold: config?.consensusThreshold,
            debateRounds: config?.debateRounds,
            maxTurns: config?.maxTurns,
            timeoutMs: config?.timeoutMs || 120000,
            streamIntermediate: config?.streamIntermediate ?? true,
        };
        return this;
    }

    /** Configure fallback strategy */
    withFallback(strategy: Partial<FallbackStrategy>): TeamBuilder {
        this.team.fallbackStrategy = {
            ...this.team.fallbackStrategy,
            ...strategy,
        } as FallbackStrategy;
        return this;
    }

    /** Set max parallel agents */
    withMaxParallel(max: number): TeamBuilder {
        this.team.maxParallelAgents = max;
        return this;
    }

    /** Enable/disable shared context */
    withSharedContext(enabled: boolean): TeamBuilder {
        this.team.sharedContext = enabled;
        return this;
    }

    /** Enable/disable checkpoints */
    withCheckpoints(enabled: boolean): TeamBuilder {
        this.team.checkpointEnabled = enabled;
        return this;
    }

    /** Build the final team configuration */
    build(): TeamConfig {
        if (!this.coordinatorId) {
            throw new Error("Team must have a coordinator. Call .withCoordinator() first.");
        }

        if (!this.team.protocol) {
            this.team.protocol = { type: "hierarchical", maxDepth: 3, streamIntermediate: true };
        }

        // Resolve hierarchy
        const agentList = Array.from(this.agents.values());
        for (const edge of this.hierarchyEdges) {
            const child = this.agents.get(edge.child);
            const parent = this.agents.get(edge.parent);
            if (child && parent) {
                child.parentId = parent.id;
                if (!parent.canDelegateTo) parent.canDelegateTo = [];
                parent.canDelegateTo.push(child.id!);
            }
        }

        return {
            ...this.team,
            coordinatorId: this.coordinatorId,
            agents: agentList,
        } as TeamConfig;
    }

    private buildBackend(config: Pick<AgentBuilderConfig, "provider" | "model" | "apiKey" | "baseUrl" | "temperature" | "maxTokens">): BackendConfig {
        return {
            provider: config.provider,
            model: config.model,
            apiKey: config.apiKey,
            baseUrl: config.baseUrl,
            temperature: config.temperature ?? 0.7,
            maxTokens: config.maxTokens,
            timeoutMs: 60000,
        };
    }

    private buildFallbacks(config: AgentBuilderConfig): BackendConfig[] {
        if (!config.fallbackModels) return [];
        return config.fallbackModels.map(fb => ({
            provider: fb.provider,
            model: fb.model,
            temperature: 0.7,
            timeoutMs: 60000,
        }));
    }
}