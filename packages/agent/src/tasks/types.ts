/**
 * Task System Types
 */

import type { TaskId, AgentId, TaskStatus, TaskPriority, TaskResult, SubTask } from "../types";

export interface TaskGraph {
    tasks: SubTask[];
    edges: Array<{ from: TaskId; to: TaskId; type: "depends-on" | "triggers" }>;
}

export interface DecompositionPlan {
    originalTask: string;
    subtasks: Array<{
        title: string;
        description: string;
        estimatedComplexity: "low" | "medium" | "high";
        requiredCapabilities: string[];
        suggestedAgent?: AgentId;
    }>;
    parallelGroups: TaskId[][];
    estimatedTotalTokens: number;
}