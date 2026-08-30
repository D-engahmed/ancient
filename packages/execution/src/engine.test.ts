// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Execution engine tests (engine) — task → profiler → selector → strategy stream
// over a real capability registry, with lifecycle, cancellaration, and event
// recording on the infra bus.

import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { makeError } from "@ANCIENT/contracts";
import { CapabilityRegistry } from "@ANCIENT/capabilities/core";
import { MemoryEventBus } from "@ANCIENT/infrastructure/events";
import { ApprovalPolicy } from "@ANCIENT/infrastructure/security";
import type { ModelTurnResult } from "@ANCIENT/strategies";
import { ExecutionEngine } from "./engine";
import type { ModelChat, RunRequest } from "./types";

function registry(): CapabilityRegistry {
    return new CapabilityRegistry()
        .register({
            name: "readFile",
            description: "Read a file.",
            inputSchema: z.object({ path: z.string() }),
            category: "read",
            execute: async (_scope, args) => `content of ${(args as { path: string }).path}`,
        })
        .register({
            name: "bash",
            description: "Run a shell command.",
            inputSchema: z.object({ command: z.string() }),
            category: "exec",
            execute: async () => "ran",
        })
        .register({
            name: "writeFile",
            description: "Write a file.",
            inputSchema: z.object({ path: z.string(), content: z.string() }),
            category: "write",
            execute: async () => "written",
        });
}

function scripted(turns: ModelTurnResult[]): ModelChat {
    let i = 0;
    return async () => {
        const entry = turns[Math.min(i, turns.length - 1)]!;
        i += 1;
        return entry;
    };
}

function turn(text: string, toolCalls: ModelTurnResult["toolCalls"] = []): ModelTurnResult {
    return { text, toolCalls, usage: { inputTokens: 10, outputTokens: 5 } };
}

function call(name: string, args: unknown = {}, id = `c${Math.random().toString(36).slice(2, 8)}`) {
    return { id, name, args };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function request(over: Partial<RunRequest> & { model: ModelChat; task: string }): RunRequest {
    return {
        scope: { cwd: process.cwd() },
        policy: new ApprovalPolicy(),
        ...over,
    } as RunRequest;
}

describe("ExecutionEngine", () => {
    it("completes a simple direct task end-to-end with lifecycle + recorded stream", async () => {
        const bus = new MemoryEventBus();
        const engine = new ExecutionEngine({ registry: registry(), bus });
        const lifecycle: string[] = [];
        bus.subscribe((e) => {
            lifecycle.push(e.type);
        });

        const session = engine.run(
            request({ task: "fix the typo in the README", model: scripted([turn("done. typo fixed.")]) }),
        );

        const result = await session.done;
        expect(result.status).toBe("completed");
        expect(result.strategy.id).toBe("direct");
        expect(result.output).toContain("typo fixed");
        expect(lifecycle).toEqual(["created", "started", "completed"]);

        const types = session.events().map((e) => e.type);
        expect(types).toEqual(["strategy-selected", "text-delta", "done"]);
        expect(result.usage.inputTokens).toBe(10);
    });

    it("applies the engine context to every model turn (A-ENG-002)", async () => {
        const bus = new MemoryEventBus();
        const engine = new ExecutionEngine({ registry: registry(), bus });
        const seen: Array<{ system?: string; prompt?: string; history?: { role: string; text: string }[] }> = [];
        const capturing: ModelChat = async (input) => {
            seen.push(input);
            return turn("done.");
        };

        const session = engine.run(
            request({
                task: "fix the typo in the README",
                model: capturing,
                context: { blocks: { memory: "## Memory\nreview conventions before coding" } },
            }),
        );
        const result = await session.done;
        expect(result.status).toBe("completed");

        const call = seen[0]!;
        expect(call.system).toContain("You are ANCIENT");          // engine identity base
        expect(call.system).toContain("## Memory");                 // injected block
        expect(call.system).toContain("# Execution directive");     // strategy framing layered beneath
        expect(call.prompt).toContain("Task: fix the typo in the README"); // guaranteed task brief
    });

    it("drives an agent-loop run through tools on the central edge", async () => {
        const bus = new MemoryEventBus();
        const engine = new ExecutionEngine({ registry: registry(), bus });
        const toolEvents: Record<string, unknown>[] = [];
        bus.subscribe((e) => {
            if (e.type === "tool-executed") toolEvents.push(e.payload ?? {});
        });

        // moderate + tools → agent-loop; model does readFile then finishes.
        const session = engine.run(
            request({
                task: "add a note to the README using readFile and writeFile",
                model: scripted([
                    turn("reading", [call("readFile", { path: "README.md" })]),
                    turn("also reading config", [call("readFile", { path: "config.json" })]),
                    turn("done"),
                ]),
            }),
        );

        const result = await session.done;
        expect(result.status).toBe("completed");
        expect(result.strategy.id).toBe("agent-loop");
        expect(result.toolCount).toBe(2);
        expect(result.turnCount).toBe(3);
        expect(toolEvents).toHaveLength(2);
        expect(toolEvents[0]).toMatchObject({ tool: "readFile", ok: true });
    });

    it("surfaces policy denials as ok:false tool events, never as crashes", async () => {
        const bus = new MemoryEventBus();
        const engine = new ExecutionEngine({ registry: registry(), bus });
        const toolEvents: Record<string, unknown>[] = [];
        bus.subscribe((e) => {
            if (e.type === "tool-executed") toolEvents.push(e.payload ?? {});
        });

        const session = engine.run(
            request({
                task: "run a build script with bash",
                model: scripted([
                    turn("running", [call("bash", { command: "./build.sh" })]),
                    turn("report", [call("readFile", { path: "out.txt" })]),
                    turn("done"),
                ]),
            }),
        );

        const result = await session.done;
        expect(result.status).toBe("completed"); // strategy absorbs denials and continues
        expect(toolEvents[0]).toMatchObject({ tool: "bash", ok: false });
        expect(result.error).toBeUndefined();
    });

    it("fails when the strategy emits an error (e.g. model run fails)", async () => {
        const engine = new ExecutionEngine({ registry: registry(), bus: new MemoryEventBus() });
        const broken: ModelChat = async () => {
            throw new Error("provider exploded");
        };
        const session = engine.run(request({ task: "fix my widgets", model: broken }));
        const result = await session.done;
        expect(result.status).toBe("failed");
        expect(result.error).toContain("provider exploded");
        expect(session.status).toBe("failed");
    });

    it("escalates once when a run used tools but produced no final text", async () => {
        const bus = new MemoryEventBus();
        const engine = new ExecutionEngine({ registry: registry(), bus });
        const lifecycle: string[] = [];
        bus.subscribe((e) => {
            lifecycle.push(e.type);
        });

        // Force direct (rung 0): the model runs a tool, then returns empty text
        // in both passes — that is an INCOMPLETE run, not a success. The engine
        // must degrade and re-select a heavier strategy (agent-loop, rung 1).
        const session = engine.run(
            request({
                task: "read the config",
                profile: { complexity: "simple" },
                model: scripted([
                    turn("", [call("readFile", { path: "x.ts" })]),
                    turn(""),
                    turn("deep analysis report"),
                ]),
            }),
        );

        const result = await session.done;
        expect(result.status).toBe("completed");
        expect(result.strategy.id).toBe("agent-loop"); // escalated, not direct
        expect(result.output).toContain("deep analysis report");
        expect(result.toolCount).toBe(1);
        expect(lifecycle).toContain("degraded");
        // created → started ⇒ degraded ⇒ started ⇒ completed
        expect(lifecycle.filter((t) => t === "started")).toHaveLength(2);
        expect(lifecycle.at(-1)).toBe("completed");
    });

    it("does not escalate noisy-but-nonempty output", async () => {
        const bus = new MemoryEventBus();
        const engine = new ExecutionEngine({ registry: registry(), bus });
        const lifecycle: string[] = [];
        bus.subscribe((e) => {
            lifecycle.push(e.type);
        });

        // direct, tool ran, but the continuation produced real text — no
        // re-selection is warranted; the run completes on direct.
        const session = engine.run(
            request({
                task: "read the config",
                profile: { complexity: "simple" },
                model: scripted([
                    turn("reading", [call("readFile", { path: "x.ts" })]),
                    turn("founded the answer"),
                ]),
            }),
        );

        const result = await session.done;
        expect(result.status).toBe("completed");
        expect(result.strategy.id).toBe("direct");
        expect(lifecycle).not.toContain("degraded");
        expect(lifecycle.filter((t) => t === "started")).toHaveLength(1);
    });

    it("retries a transient failure once, then completes (Failed → Queued edge)", async () => {
        const bus = new MemoryEventBus();
        const engine = new ExecutionEngine({ registry: registry(), bus });
        const lifecycle: string[] = [];
        bus.subscribe((e) => {
            lifecycle.push(e.type);
        });

        // First model call throws a typed TRANSIENT envelope (Layer 20); the
        // second heals. The Lifecycle Manager must re-queue + retry, not fail.
        let calls = 0;
        const flaky: ModelChat = async () => {
            calls += 1;
            if (calls === 1) {
                throw makeError({
                    code: "PROVIDER_RATE_LIMITED",
                    domain: "provider",
                    message: "429 on anthropic",
                    transient: true,
                    retryableAsIs: true,
                });
            }
            return turn("done. retried and fixed.");
        };
        const interval = 5; // tiny backoff so the test is fast
        const session = engine.run(
            request({ task: "fix my widgets", model: flaky, retryBudget: { maxAttempts: 2, baseDelayMs: interval, maxDelayMs: interval, jitter: false, backoffMultiplier: 1 } }),
        );

        const result = await session.done;
        expect(result.status).toBe("completed");
        expect(result.retryCount).toBe(1);
        expect(calls).toBe(2);
        expect(result.output).toContain("retried and fixed");
        expect(lifecycle).toContain("retrying");
        expect(lifecycle).not.toContain("failed");
        expect(lifecycle.at(-1)).toBe("completed");
    });

    it("never retries a non-transient envelope (terminal on first attempt)", async () => {
        const bus = new MemoryEventBus();
        const engine = new ExecutionEngine({ registry: registry(), bus });
        const lifecycle: string[] = [];
        bus.subscribe((e) => {
            lifecycle.push(e.type);
        });

        const terminalThrow: ModelChat = async () => {
            throw makeError({
                code: "POLICY_DENIED",
                domain: "policy",
                message: "policy says no",
                transient: false,
            });
        };
        const session = engine.run(request({ task: "fix my widgets", model: terminalThrow }));
        const result = await session.done;
        expect(result.status).toBe("failed");
        expect(result.retryCount).toBe(0);
        expect(result.lastError?.code).toBe("POLICY_DENIED");
        expect(lifecycle).not.toContain("retrying");
    });

    it("cancels a hung run deterministically", async () => {
        const bus = new MemoryEventBus();
        const engine = new ExecutionEngine({ registry: registry(), bus });
        const lifecycle: string[] = [];
        bus.subscribe((e) => {
            lifecycle.push(e.type);
        });

        let releaseModel!: () => void;
        const gate = new Promise<void>((r) => (releaseModel = r));
        const gated: ModelChat = async () => {
            await gate;
            return turn("slow turn", [call("readFile", { path: "x" })]);
        };

        const session = engine.run(
            request({ task: "do the slow work", model: gated, profile: { complexity: "moderate" } }),
        );
        await tick();
        session.cancel("user aborted");
        releaseModel();

        const result = await session.done;
        expect(result.status).toBe("cancelled");
        expect(result.error).toContain("user aborted");
        expect(session.status).toBe("cancelled");
        expect(lifecycle).toContain("started");
        expect(lifecycle).not.toContain("completed");
        expect(lifecycle.at(-1)).toBe("failed"); // cancelled published as failed{reason:cancelled}
    });

    it("ballots runs get distinct sessions correlated by executionId", async () => {
        const bus = new MemoryEventBus();
        const engine = new ExecutionEngine({ registry: registry(), bus });
        const seen = new Set<string>();
        bus.subscribe((e) => {
            seen.add(e.executionId);
        });

        const s1 = engine.run(request({ task: "fix a typo", model: scripted([turn("a")]) }));
        const s2 = engine.run(request({ task: "fix a typo again", model: scripted([turn("b")]) }));
        const [r1, r2] = await Promise.all([s1.done, s2.done]);
        expect(r1.sessionId).not.toBe(r2.sessionId);
        expect(seen.size).toBe(2);
        expect(r1.strategy.id).toBe("direct");
        expect(r2.strategy.id).toBe("direct");
    });
});