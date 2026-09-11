// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Experiences (ASSUMPTION-024, Layer 1 "one engine, many experiences").
// Coding, Design, Cowork, and General are NOT engines — they are thin
// adapters that map product actions onto one canonical ExperienceRequest,
// which the /v1 API translates into a single execution surface. Adding an
// experience is a registry entry, never a new execution path or engine fork.

import { z } from "zod";
import { modeSchema, chatModelSelectionSchema } from "./schemas";

export const experienceIdSchema = z.enum(["coding", "design", "cowork", "general"]);
export type ExperienceId = z.infer<typeof experienceIdSchema>;

export const riskCategorySchema = z.enum(["read", "write", "exec", "network", "scope"]);
export type RiskCategory = z.infer<typeof riskCategorySchema>;

export type ExperienceDefaults = {
    id: ExperienceId;
    label: string;
    description: string;
    defaultMode: "BUILD" | "PLAN";
    defaultAllow: readonly RiskCategory[];
};

/** The experiences the base platform ships. New ones register here. */
export const EXPERIENCE_REGISTRY = [
    {
        id: "coding",
        label: "Coding",
        description: "Build, edit, and run code in a workspace.",
        defaultMode: "BUILD",
        defaultAllow: ["read", "write", "exec", "scope"],
    },
    {
        id: "design",
        label: "Design",
        description: "Draft and iterate on visual artifacts — no code execution.",
        defaultMode: "BUILD",
        defaultAllow: ["read", "write"],
    },
    {
        id: "cowork",
        label: "Cowork",
        description: "Collaborative planning and review — read-only by default.",
        defaultMode: "PLAN",
        defaultAllow: ["read"],
    },
    {
        id: "general",
        label: "General",
        description: "A default read-only workspace.",
        defaultMode: "BUILD",
        defaultAllow: ["read"],
    },
] as const satisfies readonly ExperienceDefaults[];

export const experienceRequestSchema = z.object({
    experienceId: experienceIdSchema,
    task: z.string().min(1).max(100_000),
    mode: modeSchema.optional(),
    model: chatModelSelectionSchema.optional(),
    cwd: z.string().min(1).optional(),
    allow: z.array(riskCategorySchema).optional(),
    toolAllow: z.array(z.string()).optional(),
});
export type ExperienceRequest = z.infer<typeof experienceRequestSchema>;

/** Canonical request minus the experience id (the URL/path carries it). */
export const experienceActionSchema = experienceRequestSchema.omit({ experienceId: true });

export function findExperience(id: string): ExperienceDefaults | undefined {
    return EXPERIENCE_REGISTRY.find((e) => e.id === id);
}

/**
 * Canonical ExperienceRequest → the single execution surface request body
 * (what /v1/executions already accepts). Experience defaults fill in the gaps;
 * explicit fields always win.
 */
export function experienceToExecution(req: ExperienceRequest) {
    const exp = findExperience(req.experienceId);
    return {
        task: req.task,
        mode: req.mode ?? exp?.defaultMode ?? "BUILD",
        ...(req.model ? { model: req.model } : {}),
        ...(req.cwd ? { cwd: req.cwd } : {}),
        allow: req.allow ?? (exp ? [...exp.defaultAllow] : ["read"]),
        ...(req.toolAllow ? { toolAllow: req.toolAllow } : {}),
    };
}