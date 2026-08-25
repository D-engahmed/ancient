/**
 * Agent Template Registry
 *
 * Pre-built agent templates that users can instantiate and customize.
 *
 * FIX: every template's `build(overrides)` took an overrides parameter and
 * never referenced it in the body — instantiate() could pass anything and
 * it silently did nothing. Replaced with ModelOverrides, a per-role map
 * that's actually applied via cfg() below. Also: "claude-3-5-sonnet" isn't
 * in @ANCIENT/shared's SUPPORTED_CHAT_MODELS (only the dated
 * "claude-3-5-sonnet-20241022" is) — findSupportedChatModel would reject
 * it. Swapped the coder/architect default to "claude-sonnet-5", a real
 * current entry. gpt-4o / gpt-4o-mini are still valid entries, left as-is —
 * which specific defaults you want is a product call, not mine to make
 * unilaterally beyond fixing what's actually broken.
 */

import type { AgentRole, BackendProvider, TeamConfig } from "../types";
import { TeamBuilder } from "./builder";
import { v4 as uuidv4 } from "uuid";

export type ModelOverrides = Partial<
    Record<AgentRole, { model: string; provider: BackendProvider; apiKey?: string; baseUrl?: string }>
>;

/** Per-role config: caller's override if present, else the template's default. */
function cfg(
    role: AgentRole,
    fallbackModel: string,
    fallbackProvider: BackendProvider,
    overrides?: ModelOverrides
): { model: string; provider: BackendProvider; apiKey?: string; baseUrl?: string } {
    const o = overrides?.[role];
    return o ?? { model: fallbackModel, provider: fallbackProvider };
}

export interface AgentTemplate {
    id: string;
    name: string;
    description: string;
    category: "development" | "review" | "research" | "devops" | "custom";
    build: (overrides?: ModelOverrides) => TeamConfig;
}

export const BUILTIN_TEMPLATES: AgentTemplate[] = [
    {
        id: "code-review-squad",
        name: "Code Review Squad",
        description: "Coordinator + Coder + Reviewer + Tester pipeline",
        category: "review",
        build: (overrides) => TeamBuilder.create("Code Review Squad", "Full pipeline for code generation and review")
            .withCoordinator("lead", cfg("coordinator", "gpt-4o", "openai", overrides))
            .addAgent("architect", { ...cfg("architect", "claude-sonnet-5", "anthropic", overrides), role: "architect", reportsTo: "lead" })
            .addAgent("implementer", { ...cfg("coder", "claude-sonnet-5", "anthropic", overrides), role: "coder", reportsTo: "lead" })
            .addAgent("reviewer", { ...cfg("reviewer", "gpt-4o-mini", "openai", overrides), role: "reviewer", reportsTo: "lead" })
            .addAgent("tester", { ...cfg("tester", "gpt-4o-mini", "openai", overrides), role: "tester", reportsTo: "lead" })
            .useProtocol("pipeline", { pipelineOrder: [] }) // auto-ordered by role
            .build(),
    },
    {
        id: "swarm-coding",
        name: "Swarm Coding",
        description: "Multiple coders work in parallel, judge picks best",
        category: "development",
        build: (overrides) => TeamBuilder.create("Swarm Coders", "Parallel coding with quality judgment")
            .withCoordinator("judge", cfg("coordinator", "gpt-4o", "openai", overrides))
            .addAgent("coder-a", { ...cfg("coder", "claude-sonnet-5", "anthropic", overrides), role: "coder", reportsTo: "judge" })
            .addAgent("coder-b", { model: "gpt-4o", provider: "openai", role: "coder", reportsTo: "judge" })
            .addAgent("coder-c", { model: "codestral-latest", provider: "openrouter", role: "coder", reportsTo: "judge" })
            .useProtocol("swarm", { agentCount: 3 })
            .build(),
    },
    {
        id: "architecture-debate",
        name: "Architecture Debate",
        description: "Two architects debate approaches, moderator decides",
        category: "research",
        build: (overrides) => TeamBuilder.create("Architecture Debate", "Adversarial architecture review")
            .withCoordinator("moderator", cfg("coordinator", "gpt-4o", "openai", overrides))
            .addAgent("architect-a", { ...cfg("architect", "claude-sonnet-5", "anthropic", overrides), role: "architect", reportsTo: "moderator" })
            .addAgent("architect-b", { model: "gpt-4o", provider: "openai", role: "architect", reportsTo: "moderator" })
            .useProtocol("debate", { debateRounds: 3 })
            .build(),
    },
    {
        id: "debug-commando",
        name: "Debug Commando",
        description: "Rapid debugging with researcher + debugger + validator",
        category: "development",
        build: (overrides) => TeamBuilder.create("Debug Commando", "Emergency debugging squad")
            .withCoordinator("commander", cfg("coordinator", "gpt-4o", "openai", overrides))
            .addAgent("researcher", { ...cfg("researcher", "gpt-4o-mini", "openai", overrides), role: "researcher", reportsTo: "commander" })
            .addAgent("debugger", { ...cfg("debugger", "claude-sonnet-5", "anthropic", overrides), role: "debugger", reportsTo: "commander" })
            .addAgent("validator", { ...cfg("validator", "gpt-4o-mini", "openai", overrides), role: "validator", reportsTo: "commander" })
            .useProtocol("hierarchical", { maxDepth: 2 })
            .build(),
    },
    {
        id: "round-robin-refinement",
        name: "Round-Robin Refinement",
        description: "Agents take turns improving code iteratively",
        category: "development",
        build: (overrides) => TeamBuilder.create("Refinement Circle", "Iterative code improvement")
            .withCoordinator("facilitator", cfg("coordinator", "gpt-4o", "openai", overrides))
            .addAgent("optimizer", { ...cfg("coder", "claude-sonnet-5", "anthropic", overrides), role: "coder", reportsTo: "facilitator" })
            .addAgent("cleaner", { model: "gpt-4o", provider: "openai", role: "reviewer", reportsTo: "facilitator" })
            .addAgent("documenter", { ...cfg("documenter", "gpt-4o-mini", "openai", overrides), role: "documenter", reportsTo: "facilitator" })
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

    instantiate(id: string, overrides?: ModelOverrides): TeamConfig | null {
        const template = this.templates.get(id);
        return template ? template.build(overrides) : null;
    }
}

export const defaultRegistry = new TemplateRegistry();
