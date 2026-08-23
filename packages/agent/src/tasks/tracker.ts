/**
 * Task Tracker
 * 
 * Real-time tracking of task execution with dependency resolution.
 */

import type { SubTask, TaskId, TaskStatus, TaskResult } from "../types";
import type { TaskGraph } from "./types";

export class TaskTracker {
    private tasks = new Map<TaskId, SubTask>();
    private graph: TaskGraph = { tasks: [], edges: [] };

    initialize(tasks: SubTask[]): void {
        for (const task of tasks) {
            this.tasks.set(task.id, task);
        }
        this.graph = { tasks, edges: [] };
    }

    getStatus(taskId: TaskId): TaskStatus {
        return this.tasks.get(taskId)?.status || "pending";
    }

    setStatus(taskId: TaskId, status: TaskStatus): void {
        const task = this.tasks.get(taskId);
        if (task) {
            task.status = status;
            if (status === "in-progress" && !task.startedAt) task.startedAt = new Date();
            if (status === "completed" || status === "failed") task.completedAt = new Date();
        }
    }

    setResult(taskId: TaskId, result: TaskResult): void {
        const task = this.tasks.get(taskId);
        if (task) {
            task.result = result;
            task.status = result.success ? "completed" : "failed";
            task.completedAt = new Date();
        }
    }

    /** Get tasks ready to execute (all dependencies completed) */
    getReadyTasks(): SubTask[] {
        return Array.from(this.tasks.values()).filter(task => {
            if (task.status !== "pending") return false;
            return task.dependencies.every(depId => {
                const dep = this.tasks.get(depId);
                return dep?.status === "completed";
            });
        });
    }

    /** Get completion percentage */
    getProgress(): number {
        const tasks = Array.from(this.tasks.values());
        if (tasks.length === 0) return 0;
        const completed = tasks.filter(t => t.status === "completed").length;
        return Math.round((completed / tasks.length) * 100);
    }

    /** Check if all tasks are done */
    isComplete(): boolean {
        return Array.from(this.tasks.values()).every(
            t => t.status === "completed" || t.status === "failed" || t.status === "cancelled"
        );
    }

    /** Get critical path (longest dependency chain) */
    getCriticalPath(): TaskId[] {
        // Simplified: return tasks sorted by dependency depth
        const depths = new Map<TaskId, number>();

        const getDepth = (taskId: TaskId): number => {
            if (depths.has(taskId)) return depths.get(taskId)!;
            const task = this.tasks.get(taskId);
            if (!task || task.dependencies.length === 0) {
                depths.set(taskId, 0);
                return 0;
            }
            const maxDepDepth = Math.max(...task.dependencies.map(getDepth));
            depths.set(taskId, maxDepDepth + 1);
            return maxDepDepth + 1;
        };

        const sorted = Array.from(this.tasks.keys()).sort((a, b) => getDepth(b) - getDepth(a));
        return sorted;
    }

    getAllTasks(): SubTask[] {
        return Array.from(this.tasks.values());
    }
}