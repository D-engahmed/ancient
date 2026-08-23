/**
 * Agent Template Registry
 * 
 * Pre-built agent templates that users can instantiate and customize.
 */

import type { AgentDefinition, TeamConfig } from "../types";
import { TeamBuilder } from "./builder";
import { v4 as uuidv4 } from "uuid";

export interface AgentTemplate {
    id: string;
    name: string;
    description: string;
    category: "development" | "review" | "research" | "devops" | "custom";
    build: (overrides?: Partial<TeamConfig>) => TeamConfig;
}

export const BUILTIN_TEMPLATES: AgentTemplate[] = [
    {
        id: "code-review-squad",
        name: "Code Review Squad",
        description: "Coordinator + Coder + Reviewer + Tester pipeline",
        category: "review",
        build: (overrides) => TeamBuilder.create("Code Review Squad", "Full pipeline for code generation and review")
            .withCoordinator("lead", { model: "gpt-4o", provider: "openai" })
            .addAgent("architect", { model: "claude-3-5-sonnet", role: "architect", provider: "anthropic", reportsTo: "lead" })
            .addAgent("implementer", { model: "claude-3-5-sonnet", role: "coder", provider: "anthropic", reportsTo: "lead" })
            .addAgent("reviewer", { model: "gpt-4o-mini", role: "reviewer", provider: "openai", reportsTo: "lead" })
            .addAgent("tester", { model: "gpt-4o-mini", role: "tester", provider: "openai", reportsTo: "lead" })
            .useProtocol("pipeline", { pipelineOrder: [] }) // Will be auto-ordered by role
            .build(),
    },
    {
        id: "swarm-coding",
        name: "Swarm Coding",
        description: "Multiple coders work in parallel, judge picks best",
        category: "development",
        build: (overrides) => TeamBuilder.create("Swarm Coders", "Parallel coding with quality judgment")
            .withCoordinator("judge", { model: "gpt-4o", provider: "openai" })
            .addAgent("coder-a", { model: "claude-3-5-sonnet", role: "coder", provider: "anthropic", reportsTo: "judge" })
            .addAgent("coder-b", { model: "gpt-4o", role: "coder", provider: "openai", reportsTo: "judge" })
            .addAgent("coder-c", { model: "codestral-latest", role: "coder", provider: "openrouter", reportsTo: "judge" })
            .useProtocol("swarm", { agentCount: 3 })
            .build(),
    },
    {
        id: "architecture-debate",
        name: "Architecture Debate",
        description: "Two architects debate approaches, moderator decides",
        category: "research",
        build: (overrides) => TeamBuilder.create("Architecture Debate", "Adversarial architecture review")
            .withCoordinator("moderator", { model: "gpt-4o", provider: "openai" })
            .addAgent("architect-a", { model: "claude-3-5-sonnet", role: "architect", provider: "anthropic", reportsTo: "moderator" })
            .addAgent("architect-b", { model: "gpt-4o", role: "architect", provider: "openai", reportsTo: "moderator" })
            .useProtocol("debate", { debateRounds: 3 })
            .build(),
    },
    {
        id: "debug-commando",
        name: "Debug Commando",
        description: "Rapid debugging with researcher + debugger + validator",
        category: "development",
        build: (overrides) => TeamBuilder.create("Debug Commando", "Emergency debugging squad")
            .withCoordinator("commander", { model: "gpt-4o", provider: "openai" })
            .addAgent("researcher", { model: "gpt-4o-mini", role: "researcher", provider: "openai", reportsTo: "commander" })
            .addAgent("debugger", { model: "claude-3-5-sonnet", role: "debugger", provider: "anthropic", reportsTo: "commander" })
            .addAgent("validator", { model: "gpt-4o-mini", role: "validator", provider: "openai", reportsTo: "commander" })
            .useProtocol("hierarchical", { maxDepth: 2 })
            .build(),
    },
    {
        id: "round-robin-refinement",
        name: "Round-Robin Refinement",
        description: "Agents take turns improving code iteratively",
        category: "development",
        build: (overrides) => TeamBuilder.create("Refinement Circle", "Iterative code improvement")
            .withCoordinator("facilitator", { model: "gpt-4o", provider: "openai" })
            .addAgent("optimizer", { model: "claude-3-5-sonnet", role: "coder", provider: "anthropic", reportsTo: "facilitator" })
            .addAgent("cleaner", { model: "gpt-4o", role: "reviewer", provider: "openai", reportsTo: "facilitator" })
            .addAgent("documenter", { model: "gpt-4o-mini", role: "documenter", provider: "openai", reportsTo: "facilitator" })
            .useProtocol("round-robin", { maxTurns: 6 })
            .build(),
    },
];

export class TemplateRegistry {
    private templates = new Map<string, AgentTemplate>();

    constructor() {
        for (const template of BUILTIN_TEMPLATES) {
            this.templates.set(template.id, template);
        }
    }

    register(template: AgentTemplate): void {
        this.templates.set(template.id, template);
    }

    get(id: string): AgentTemplate | undefined {
        return this.templates.get(id);
    }

    list(category?: string): AgentTemplate[] {
        const all = Array.from(this.templates.values());
        return category ? all.filter(t => t.category === category) : all;
    }

    instantiate(id: string, overrides?: Partial<TeamConfig>): TeamConfig | null {
        const template = this.templates.get(id);
        return template ? template.build(overrides) : null;
    }
}

export const defaultRegistry = new TemplateRegistry();