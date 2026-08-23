/**
 * Execution State Manager
 * 
 * Persists and restores execution state with checkpointing.
 */

import type { ExecutionState, Checkpoint, SharedContext } from "../types";
import { v4 as uuidv4 } from "uuid";

export class StateManager {
    private states = new Map<string, ExecutionState>();
    private checkpoints = new Map<string, Checkpoint[]>();

    saveState(state: ExecutionState): void {
        this.states.set(state.id, state);
    }

    getState(executionId: string): ExecutionState | undefined {
        return this.states.get(executionId);
    }

    createCheckpoint(state: ExecutionState, agentId: string, taskId: string, reason: string): Checkpoint {
        const checkpoint: Checkpoint = {
            id: uuidv4(),
            timestamp: new Date(),
            agentId,
            taskId,
            contextSnapshot: this.cloneContext(state.context),
            reason,
        };

        const existing = this.checkpoints.get(state.id) || [];
        existing.push(checkpoint);
        this.checkpoints.set(state.id, existing);

        return checkpoint;
    }

    restoreCheckpoint(executionId: string, checkpointId: string): ExecutionState | null {
        const state = this.states.get(executionId);
        const checkpoints = this.checkpoints.get(executionId) || [];
        const checkpoint = checkpoints.find(c => c.id === checkpointId);

        if (!state || !checkpoint) return null;

        state.context = this.cloneContext(checkpoint.contextSnapshot);
        return state;
    }

    getCheckpoints(executionId: string): Checkpoint[] {
        return this.checkpoints.get(executionId) || [];
    }

    private cloneContext(ctx: SharedContext): SharedContext {
        return {
            ...ctx,
            files: new Map(ctx.files),
            memory: new Map(ctx.memory),
            artifacts: [...ctx.artifacts],
        };
    }
}