/**
 * Task Decomposer
 * 
 * Breaks complex tasks into subtasks using an LLM planner agent.
 */

import type { AgentDefinition, ExecutionState, SubTask, TaskId } from "../types";
import type { DecompositionPlan } from "./types";
import { AgentExecutor } from "../runtime/executor";
import { v4 as uuidv4 } from "uuid";

export class TaskDecomposer {
    private executor: AgentExecutor;

    constructor(executor: AgentExecutor) {
        this.executor = executor;
    }

    async decompose(
        task: string,
        plannerAgent: AgentDefinition,
        execution: ExecutionState
    ): Promise<SubTask[]> {
        const prompt = `You are an expert task planner. Decompose the following task into subtasks.\n\n## Task\n${task}\n\n## Instructions\n1. Break the task into 2-8 specific, actionable subtasks\n2. Estimate complexity (low/medium/high)\n3. Identify required capabilities for each subtask\n4. Group subtasks that can run in parallel\n5. Return JSON with the decomposition plan`;

        const result = await this.executor.run(plannerAgent, prompt, execution, { expectJson: true });

        try {
            const plan: DecompositionPlan = JSON.parse(result.output);
            return plan.subtasks.map(st => ({
                id: uuidv4(),
                parentId: "",
                title: st.title,
                description: st.description,
                status: "pending",
                dependencies: [],
                dependents: [],
                estimatedTokens: st.estimatedComplexity === "high" ? 4000 : st.estimatedComplexity === "medium" ? 2000 : 1000,
                actualTokens: 0,
                createdAt: new Date(),
            }));
        } catch {
            // Fallback: single task
            return [{
                id: uuidv4(),
                parentId: "",
                title: "Main Task",
                description: task,
                status: "pending",
                dependencies: [],
                dependents: [],
                estimatedTokens: 2000,
                actualTokens: 0,
                createdAt: new Date(),
            }];
        }
    }
}