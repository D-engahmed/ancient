// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Task profiler (engine/profiler) — the engine's "Context Runtime": infers a
// TaskProfile from the task text before any model call. Pure rules (no LLM), so
// the ladder decision stays cheap, deterministic, and testable. Explicit hints in
// RunRequest.profile always win over inference — the ENGINE decides (A-EXEC-002:
// complexity is cost-earned, not UI-chosen).

import { classifyPrompt } from "@ANCIENT/infrastructure/providers";
import type { ComplexityTier, TaskProfile } from "@ANCIENT/strategies";
import type { ModeType } from "@ANCIENT/shared";

/** Capability tool names we ship; mention in a task → task needs that tool. */
const KNOWN_TOOLS = [
    "readFile", "writeFile", "editFile", "listDirectory", "glob", "grep",
    "bash", "fetchUrl", "listSkills", "useSkill", "listMcpServers",
] as const;

const PARALLEL_SIGNALS = [
    "parallel", "independent", "many files", "multiple files", "several",
    "across the codebase", "whole project", "batch", "in parallel",
    "whole system", "whole codebase", "entire system", "entire codebase",
];

/**
 * Repo-scale audit prompts: open-ended "analyze everything and tell me all
 * the bugs" asks need real scouting + synthesis, never a single direct turn.
 * Hitting any of these raises the tier to at least "complex" so the ladder
 * selects a scouting strategy (subagents), not the one-turn direct rung.
 */
const AUDIT_SIGNALS = [
    "list every", "list all", "all bugs", "every bug", "whole system", "whole codebase",
    "entire codebase", "analyze the codebase", "audit the", "synthesize",
    "give me a report", "write a report", "comprehensive review", "review the entire",
];

const CHARS_PER_TOKEN = 4;

/** Complexity from the infra routing heuristic's score. */
export function tierFromScore(score: number): Exclude<ComplexityTier, "trivial"> {
    if (score >= 6) return "very-complex";
    if (score >= 3) return "complex";
    if (score >= 1) return "moderate";
    return "simple";
}

export function detectParallelizable(task: string): boolean {
    const text = task.toLowerCase();
    return PARALLEL_SIGNALS.some((s) => text.includes(s));
}

export function detectRequiredTools(task: string): string[] {
    const lower = task.toLowerCase();
    return KNOWN_TOOLS.filter((name) => lower.includes(name.toLowerCase()));
}

/** Rough deterministic token budget for the task before any model turn. */
export function estimateTokens(task: string, complexity: ComplexityTier): number {
    const base = Math.round(task.length / CHARS_PER_TOKEN);
    const floor: Record<ComplexityTier, number> = {
        trivial: 400,
        simple: 800,
        moderate: 2_000,
        complex: 4_000,
        "very-complex": 8_000,
    };
    return base + floor[complexity];
}

/** Full profile inference; explicit `hints` override inference. */
export function inferProfile(
    task: string,
    mode: ModeType = "BUILD",
    hints: Partial<TaskProfile> = {},
): TaskProfile {
    const text = task.toLowerCase();
    const base = tierFromScore(classifyPrompt(task, mode));
    const detected = detectRequiredTools(task);
    // Mentioning real tools is a moderate-work signal: a task that names
    // readFile/writeFile/bash is rarely a single direct turn, so bump out of
    // direct's trust zone (which the ladder enforces below).
    const bumped = detected.length > 0 && base === "simple" ? "moderate" : base;
    // Repo-scale audit/synthesis prompts are never a one-turn answer: raise to
    // complex so the ladder picks a scouting + synthesizing rung (subagents).
    const auditHit = AUDIT_SIGNALS.some((s) => text.includes(s));
    const complexity = hints.complexity ?? (auditHit ? "complex" : bumped);
    return {
        description: task,
        complexity,
        parallelizable: hints.parallelizable ?? detectParallelizable(task),
        estimatedTokens: hints.estimatedTokens ?? estimateTokens(task, complexity),
        tools: hints.tools ?? detected,
        mode,
        preferredStrategy: hints.preferredStrategy,
    };
}