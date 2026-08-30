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
    const base = tierFromScore(classifyPrompt(task, mode));
    const detected = detectRequiredTools(task);
    // Mentioning real tools is a moderate-work signal: a task that names
    // readFile/writeFile/bash is rarely a single direct turn, so bump out of
    // direct's trust zone (which the ladder enforces below).
    const complexity = hints.complexity ?? (detected.length > 0 && base === "simple" ? "moderate" : base);
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