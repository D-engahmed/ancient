/**
 * Role Definitions
 *
 * Default system prompt, capabilities, tools, and delegation limits per
 * AgentRole. This file did not exist before — team/builder.ts and
 * team/index.ts both imported from it and neither import resolved.
 *
 * Tool names match docs/SUBAGENTS.md's built-in tool set (readFile,
 * listDirectory, glob, grep, bash) plus writeFile/editFile for roles that
 * actually need to modify code, rather than inventing a parallel tool
 * naming scheme.
 */

import type { AgentCapability, AgentRole } from "../types";

export interface RoleConfig {
    role: AgentRole;
    defaultSystemPrompt: string;
    defaultCapabilities: AgentCapability[];
    defaultTools: string[];
    maxDelegationDepth: number;
    preferredModels: string[];
}

const READ_ONLY_TOOLS = ["readFile", "listDirectory", "glob", "grep"];
const CODE_TOOLS = [...READ_ONLY_TOOLS, "writeFile", "editFile", "bash"];

export const ROLE_DEFINITIONS: Record<AgentRole, RoleConfig> = {
    coordinator: {
        role: "coordinator",
        defaultSystemPrompt:
            "You are the coordinator of a multi-agent team. You decompose the incoming task, " +
            "assign subtasks to the right specialists, and synthesize their reports into one " +
            "final result. You do not write code yourself — you delegate and integrate.",
        defaultCapabilities: ["planning"],
        defaultTools: READ_ONLY_TOOLS,
        maxDelegationDepth: 3,
        preferredModels: ["claude-fable-5", "gpt-5.6-sol"],
    },
    architect: {
        role: "architect",
        defaultSystemPrompt:
            "You are a software architect. Given a task, you decide on structure, interfaces, " +
            "and the division of work between components before any code is written.",
        defaultCapabilities: ["architecture-design", "planning"],
        defaultTools: READ_ONLY_TOOLS,
        maxDelegationDepth: 2,
        preferredModels: ["claude-fable-5", "claude-opus-4-8"],
    },
    coder: {
        role: "coder",
        defaultSystemPrompt:
            "You are an implementation specialist. Given a specific, scoped task, you write " +
            "correct, working code and explain the key decisions in your final report.",
        defaultCapabilities: ["code-generation"],
        defaultTools: CODE_TOOLS,
        maxDelegationDepth: 1,
        preferredModels: ["claude-sonnet-5", "gpt-5.4"],
    },
    reviewer: {
        role: "reviewer",
        defaultSystemPrompt:
            "You are a senior code reviewer. Given a diff or a set of changes, you find real " +
            "bugs, security issues, and design problems, ranked by severity. You do not rewrite " +
            "the code yourself.",
        defaultCapabilities: ["code-review"],
        defaultTools: READ_ONLY_TOOLS,
        maxDelegationDepth: 1,
        preferredModels: ["claude-sonnet-5", "gpt-5.4-mini"],
    },
    tester: {
        role: "tester",
        defaultSystemPrompt:
            "You write and run tests for the given change, and summarize failures with enough " +
            "detail that a coder could fix them without re-running anything themselves.",
        defaultCapabilities: ["testing"],
        defaultTools: CODE_TOOLS,
        maxDelegationDepth: 1,
        preferredModels: ["gpt-5.4-mini", "claude-haiku-4-5"],
    },
    debugger: {
        role: "debugger",
        defaultSystemPrompt:
            "You are a root-cause investigator. Given an error and its symptoms, you trace the " +
            "actual cause before proposing a fix — you do not guess.",
        defaultCapabilities: ["debugging"],
        defaultTools: CODE_TOOLS,
        maxDelegationDepth: 1,
        preferredModels: ["claude-sonnet-5", "gpt-5.4"],
    },
    researcher: {
        role: "researcher",
        defaultSystemPrompt:
            "You gather and summarize the information the team needs — prior art, library docs, " +
            "existing code patterns — without drawing conclusions the evidence doesn't support.",
        defaultCapabilities: ["research"],
        defaultTools: READ_ONLY_TOOLS,
        maxDelegationDepth: 1,
        preferredModels: ["gpt-5.4-mini", "claude-haiku-4-5"],
    },
    validator: {
        role: "validator",
        defaultSystemPrompt:
            "You check a proposed change or output against the original requirements and flag " +
            "anything that doesn't hold up, before it's treated as done.",
        defaultCapabilities: ["testing", "code-review"],
        defaultTools: READ_ONLY_TOOLS,
        maxDelegationDepth: 1,
        preferredModels: ["gpt-5.4-mini", "claude-haiku-4-5"],
    },
    documenter: {
        role: "documenter",
        defaultSystemPrompt:
            "You write clear, accurate documentation for the work the team produced — no more " +
            "and no less than what actually changed.",
        defaultCapabilities: ["documentation"],
        defaultTools: READ_ONLY_TOOLS,
        maxDelegationDepth: 1,
        preferredModels: ["gpt-5.4-mini", "claude-haiku-4-5"],
    },
};

export function getRoleConfig(role: AgentRole): RoleConfig {
    return ROLE_DEFINITIONS[role];
}

export function getDefaultSystemPrompt(role: AgentRole): string {
    return ROLE_DEFINITIONS[role].defaultSystemPrompt;
}

export function getDefaultCapabilities(role: AgentRole): AgentCapability[] {
    return ROLE_DEFINITIONS[role].defaultCapabilities;
}

export function getDefaultTools(role: AgentRole): string[] {
    return ROLE_DEFINITIONS[role].defaultTools;
}

export function getPreferredModels(role: AgentRole): string[] {
    return ROLE_DEFINITIONS[role].preferredModels;
}

export function getMaxDelegationDepth(role: AgentRole): number {
    return ROLE_DEFINITIONS[role].maxDelegationDepth;
}

/**
 * Who can delegate to whom. Deliberately conservative: the coordinator can
 * delegate to any specialist, a small set of "leads" that decompose their
 * own work further (architect, debugger) into the roles that act on it, and
 * everyone else is a leaf. Loosen this as real templates need deeper trees —
 * don't pre-declare depth the code has no way to exercise.
 */
const DELEGATION_MAP: Partial<Record<AgentRole, AgentRole[]>> = {
    coordinator: ["architect", "coder", "reviewer", "tester", "debugger", "researcher", "validator", "documenter"],
    architect: ["coder", "reviewer"],
    debugger: ["coder", "validator"],
};

export function canDelegate(fromRole: AgentRole, toRole: AgentRole): boolean {
    return DELEGATION_MAP[fromRole]?.includes(toRole) ?? false;
}
