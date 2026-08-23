/**
 * Agent Hierarchy Manager
 * 
 * Manages reporting chains, delegation paths, and org-chart logic.
 */

import type { AgentDefinition, AgentId, AgentRef } from "../types";

export class HierarchyManager {
    private agents = new Map<AgentId, AgentRef>();

    constructor(agents: AgentDefinition[]) {
        for (const agent of agents) {
            this.agents.set(agent.id!, {
                id: agent.id!,
                name: agent.name,
                role: agent.role,
                model: agent.backend.model,
                provider: agent.backend.provider,
                capabilities: agent.capabilities,
                status: "idle",
                parentId: agent.parentId,
                childrenIds: [],
            });
        }

        // Build children links
        for (const [id, ref] of this.agents) {
            if (ref.parentId && this.agents.has(ref.parentId)) {
                const parent = this.agents.get(ref.parentId)!;
                parent.childrenIds!.push(id);
            }
        }
    }

    /** Get org chart as tree */
    getTree(rootId?: AgentId): AgentRef | null {
        if (!rootId) {
            // Find root (no parent)
            for (const [id, ref] of this.agents) {
                if (!ref.parentId) return this.buildSubtree(id);
            }
            return null;
        }
        return this.buildSubtree(rootId);
    }

    /** Get delegation path from agent to root */
    getDelegationPath(agentId: AgentId): AgentRef[] {
        const path: AgentRef[] = [];
        let current = this.agents.get(agentId);

        while (current) {
            path.unshift(current);
            current = current.parentId ? this.agents.get(current.parentId) : undefined;
        }

        return path;
    }

    /** Get all subordinates (recursive) */
    getSubordinates(agentId: AgentId): AgentRef[] {
        const result: AgentRef[] = [];
        const root = this.agents.get(agentId);
        if (!root) return result;

        const queue = [...(root.childrenIds || [])];
        while (queue.length > 0) {
            const id = queue.shift()!;
            const agent = this.agents.get(id);
            if (agent) {
                result.push(agent);
                queue.push(...(agent.childrenIds || []));
            }
        }

        return result;
    }

    /** Who can this agent delegate to? */
    getDelegationTargets(agentId: AgentId): AgentRef[] {
        const agent = this.agents.get(agentId);
        if (!agent) return [];

        // Direct children + agents with matching capabilities
        const children = (agent.childrenIds || [])
            .map(id => this.agents.get(id))
            .filter(Boolean) as AgentRef[];

        return children;
    }

    /** Update agent status */
    setStatus(agentId: AgentId, status: AgentRef["status"]): void {
        const agent = this.agents.get(agentId);
        if (agent) agent.status = status;
    }

    private buildSubtree(id: AgentId): AgentRef {
        const ref = this.agents.get(id)!;
        return {
            ...ref,
            childrenIds: ref.childrenIds?.map(childId => this.buildSubtree(childId).id),
        };
    }
}