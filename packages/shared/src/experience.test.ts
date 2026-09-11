import { describe, expect, it } from "bun:test";
import {
    EXPERIENCE_REGISTRY,
    experienceActionSchema,
    experienceRequestSchema,
    experienceToExecution,
    findExperience,
} from "./experience";

describe("EXPERIENCE_REGISTRY", () => {
    it("ships the four base experiences", () => {
        expect(EXPERIENCE_REGISTRY.map((e) => e.id)).toEqual(["coding", "design", "cowork", "general"]);
    });

    it("keeps coding as the build experience with exec allowed", () => {
        const coding = findExperience("coding")!;
        expect(coding.defaultMode).toBe("BUILD");
        expect(coding.defaultAllow).toContain("exec");
        expect(coding.defaultAllow).toContain("write");
    });

    it("keeps cowork read-only and PLAN-oriented by default", () => {
        const cowork = findExperience("cowork")!;
        expect(cowork.defaultMode).toBe("PLAN");
        expect(cowork.defaultAllow).toEqual(["read"]);
    });
});

describe("experienceRequestSchema", () => {
    it("accepts a valid coding request", () => {
        const parsed = experienceRequestSchema.safeParse({
            experienceId: "coding",
            task: "Refactor the payment module.",
            cwd: "/workspace/app",
        });
        expect(parsed.success).toBe(true);
    });

    it("rejects an unknown experience id", () => {
        const parsed = experienceRequestSchema.safeParse({ experienceId: "arena", task: "x" });
        expect(parsed.success).toBe(false);
    });

    it("rejects an empty task", () => {
        const parsed = experienceRequestSchema.safeParse({ experienceId: "general", task: "" });
        expect(parsed.success).toBe(false);
    });
});

describe("experienceToExecution", () => {
    it("fills design defaults (read/write, BUILD)", () => {
        const execution = experienceToExecution({ experienceId: "design", task: "Redo the hero section." });
        expect(execution).toEqual({
            task: "Redo the hero section.",
            mode: "BUILD",
            allow: ["read", "write"],
        });
    });

    it("lets an explicit allow win over the experience default", () => {
        const execution = experienceToExecution({
            experienceId: "general",
            task: "Inspect deployment scripts.",
            allow: ["read", "exec"],
        });
        expect(execution.allow).toEqual(["read", "exec"]);
    });

    it("carries an explicit model selection through", () => {
        const execution = experienceToExecution({
            experienceId: "coding",
            task: "Add tests.",
            model: { modelKind: "custom", connectionId: "conn-1" },
        });
        expect(execution.model).toEqual({ modelKind: "custom", connectionId: "conn-1" });
    });

    it("experienceActionSchema rejects a stray experienceId field", () => {
        const parsed = experienceActionSchema.safeParse({ experienceId: "coding", task: "x" });
        expect(parsed.success).toBe(true); // extra keys are stripped by zod default
        const out = parsed.success ? parsed.data : null;
        expect(out && "experienceId" in out).toBe(false);
    });
});