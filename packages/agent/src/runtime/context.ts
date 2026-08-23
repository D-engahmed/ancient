/**
 * Shared Context Manager
 * 
 * Manages the shared workspace between agents.
 */

import type { SharedContext, Artifact, ExecutionId } from "../types";

export class ContextManager {
    private contexts = new Map<ExecutionId, SharedContext>();

    create(executionId: string, workingDirectory: string): SharedContext {
        const ctx: SharedContext = {
            executionId,
            workingDirectory,
            files: new Map(),
            memory: new Map(),
            artifacts: [],
            constraints: [],
            userPreferences: {},
        };
        this.contexts.set(executionId, ctx);
        return ctx;
    }

    get(executionId: string): SharedContext | undefined {
        return this.contexts.get(executionId);
    }

    setMemory(ctx: SharedContext, key: string, value: unknown): void {
        ctx.memory.set(key, value);
    }

    getMemory(ctx: SharedContext, key: string): unknown {
        return ctx.memory.get(key);
    }

    addArtifact(ctx: SharedContext, artifact: Artifact): void {
        ctx.artifacts.push(artifact);
    }

    addFile(ctx: SharedContext, path: string, content: string): void {
        ctx.files.set(path, content);
    }

    getFile(ctx: SharedContext, path: string): string | undefined {
        return ctx.files.get(path);
    }
}