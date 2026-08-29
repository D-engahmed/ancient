// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Capability registry (capabilities/core).
//
// The registry is the runtime's spine (A-CAP-001): modules register
// ToolDefinitions; consumers ask for a mode-gated, allow-listed slice. Registry
// itself is pure bookkeeping — policy lives in execute.ts.

import type { ModeType } from "@ANCIENT/shared";
import type { ToolDefinition } from "./types";

export class CapabilityRegistry {
    #tools = new Map<string, ToolDefinition>();

    /** Register one tool. Duplicate names are ignored (first wins) with no error. */
    register(tool: ToolDefinition): this {
        if (!this.#tools.has(tool.name)) this.#tools.set(tool.name, tool);
        return this;
    }

    registerAll(tools: readonly ToolDefinition[]): this {
        for (const t of tools) this.register(t);
        return this;
    }

    get(name: string): ToolDefinition | undefined {
        return this.#tools.get(name);
    }

    has(name: string): boolean {
        return this.#tools.has(name);
    }

    /** All registered tools, in registration order. */
    list(): ToolDefinition[] {
        return [...this.#tools.values()];
    }

    listNames(): string[] {
        return this.list().map((t) => t.name);
    }

    /**
     * Tools visible in a mode and (optionally) allow-listed by name. A tool is
     * visible in a mode when:
     *   - it declares `modes` that include the mode, OR
     *   - it declares no `modes` and the mode is PLAN-safe for its category:
     *     only `read`-category tools are PLAN-safe by default (mirrors the
     *     server's READ_ONLY_BASE_TOOLS behavior — bash/write never leak into
     *     plan mode unless a module explicitly opts in).
     */
    listFor(mode: ModeType, allow?: readonly string[]): ToolDefinition[] {
        const filter = allow ? new Set(allow) : undefined;
        return this.list().filter((t) => {
            if (filter && !filter.has(t.name)) return false;
            if (t.modes) return t.modes.includes(mode);
            // No explicit modes: BUILD always; PLAN only for read-category tools
            // (mirrors the server's READ_ONLY_BASE_TOOLS split — non-read tools
            // such as bash/write never leak into plan mode).
            return mode === "BUILD" || t.category === "read";
        });
    }
}