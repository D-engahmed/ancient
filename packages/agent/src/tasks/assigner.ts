/**
 * Task Assigner
 * 
 * Matches subtasks to agents based on capabilities, load, and performance history.
 */

import type { AgentDefinition, SubTask, AgentId, AgentCapability } from "../types";

export class TaskAssigner {
    /** Score how well an agent matches a task */
    scoreAssignment(agent: AgentDefinition, task: SubTask): number {
        let score = 0;

        // Capability match
        const requiredCaps = this.inferRequiredCapabilities(task);
        for (const cap of requiredCaps) {
            if (agent.capabilities.includes(cap as AgentCapability)) score += 10;
        }

        // Role relevance
        if (agent.role === "coder" && task.description.includes("implement")) score += 5;
        if (agent.role === "reviewer" && task.description.includes("review")) score += 5;
        if (agent.role === "tester" && task.description.includes("test")) score += 5;

        // Prefer idle agents
        // (Would check runtime state in full implementation)

        return score;
    }

    assign(tasks: SubTask[], agents: AgentDefinition[]): Map<TaskId, AgentId> {
        const assignments = new Map<TaskId, AgentId>();
        const agentLoads = new Map<AgentId, number>();

        for (const agent of agents) {
            agentLoads.set(agent.id!, 0);
        }

        // Sort tasks by estimated complexity (hardest first)
        const sortedTasks = [...tasks].sort((a, b) => (b.estimatedTokens || 0) - (a.estimatedTokens || 0));

        for (const task of sortedTasks) {
            let bestAgent: AgentDefinition | null = null;
            let bestScore = -1;

            for (const agent of agents) {
                const score = this.scoreAssignment(agent, task) - (agentLoads.get(agent.id!) || 0) * 2;
                if (score > bestScore) {
                    bestScore = score;
                    bestAgent = agent;
                }
            }

            if (bestAgent) {
                assignments.set(task.id, bestAgent.id!);
                agentLoads.set(bestAgent.id!, (agentLoads.get(bestAgent.id!) || 0) + 1);
            }
        }

        return assignments;
    }

    private inferRequiredCapabilities(task: SubTask): string[] {
        const caps: string[] = [];
        const desc = task.description.toLowerCase();

        if (desc.includes("code") || desc.includes("implement")) caps.push("code-generation");
        if (desc.includes("review") || desc.includes("check")) caps.push("code-review");
        if (desc.includes("test")) caps.push("testing");
        if (desc.includes("design") || desc.includes("architecture")) caps.push("architecture-design");
        if (desc.includes("debug") || desc.includes("fix")) caps.push("debugging");
        if (desc.includes("research") || desc.includes("find")) caps.push("research");
        if (desc.includes("document")) caps.push("documentation");
        if (desc.includes("plan")) caps.push("planning");

        return caps;
    }
}