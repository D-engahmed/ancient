/**
 * Arena Coordinator
 *
 * Actually runs a TeamConfig against a task, dispatching to one of the five
 * protocols team/builder.ts and team/registry.ts already assume exist
 * (hierarchical, pipeline, swarm, debate, round-robin). Before this file,
 * runtime/engine.ts imported ArenaCoordinator from a module that did not
 * exist — nothing here ever ran.
 *
 * Pause/resume/cancel are real, not decorative: each execution gets an
 * AbortController (passed through to BackendRouter so an in-flight model
 * call can actually be aborted) and a PauseGate that in-flight loops await
 * between steps. This does not preempt mid-generation — a paused execution
 * finishes whatever agent call is already in flight, then blocks before the
 * next one. That's the same granularity a human reviewing a running agent
 * would expect.
 */

import { v4 as uuidv4 } from "uuid";
import type {
    TeamConfig,
    TaskResult,
    ExecutionState,
    SharedContext,
    AgentDefinition,
    SubTask,
    ProtocolType,
} from "../types";
import type { AgentExecutor } from "../runtime/executor";
import { StateManager } from "../runtime/state";
import { ContextManager } from "../runtime/context";
import { TaskDecomposer } from "../tasks/decomposer";
import { TaskAssigner } from "../tasks/assigner";
import { TaskTracker } from "../tasks/tracker";
import { HierarchyManager } from "../team/hierarchy";
import type { MessageBus } from "./messaging";

class PauseGate {
    private paused = false;
    private waiters: Array<() => void> = [];

    pause(): void {
        this.paused = true;
    }

    resume(): void {
        this.paused = false;
        const waiters = this.waiters.splice(0);
        for (const w of waiters) w();
    }

    async wait(): Promise<void> {
        if (!this.paused) return;
        await new Promise<void>((resolve) => this.waiters.push(resolve));
    }

    get isPaused(): boolean {
        return this.paused;
    }
}

class ExecutionCancelledError extends Error {
    constructor(executionId: string) {
        super(`Execution ${executionId} was cancelled`);
        this.name = "ExecutionCancelledError";
    }
}

interface ExecutionHandle {
    state: ExecutionState;
    abort: AbortController;
    pauseGate: PauseGate;
}

const EMPTY_METRICS = {
    tokensIn: 0,
    tokensOut: 0,
    latencyMs: 0,
    costUsd: 0,
    toolCalls: 0,
    retries: 0,
};

function mergeMetrics(results: TaskResult[]): TaskResult["metrics"] {
    return results.reduce(
        (acc, r) => ({
            tokensIn: acc.tokensIn + r.metrics.tokensIn,
            tokensOut: acc.tokensOut + r.metrics.tokensOut,
            latencyMs: acc.latencyMs + r.metrics.latencyMs,
            costUsd: acc.costUsd + r.metrics.costUsd,
            toolCalls: acc.toolCalls + r.metrics.toolCalls,
            retries: acc.retries + r.metrics.retries,
        }),
        { ...EMPTY_METRICS }
    );
}

export class ArenaCoordinator {
    private executions = new Map<string, ExecutionHandle>();
    private stateManager = new StateManager();
    private contextManager = new ContextManager();
    private hierarchyManagers = new Map<string, HierarchyManager>();

    constructor(
        private executor: AgentExecutor,
        private messageBus: MessageBus
    ) {}

    async execute(team: TeamConfig, task: string): Promise<TaskResult> {
        return this.startExecution(team, task).result;
    }

    /**
     * Same as execute(), but returns the executionId synchronously instead
     * of only after the whole run finishes. Needed for any caller (the HTTP
     * layer, in particular) that wants to hand back an id to poll
     * getExecutionStatus() with while a long-running team execution is still
     * in flight — execute() alone can't support that, since its promise
     * doesn't resolve until the run is over.
     */
    startExecution(team: TeamConfig, task: string): { executionId: string; result: Promise<TaskResult> } {
        const executionId = uuidv4();
        const context = this.contextManager.create(executionId, process.cwd());
        const state: ExecutionState = {
            id: executionId,
            team,
            task,
            status: "running",
            context,
            startedAt: new Date(),
        };

        const handle: ExecutionHandle = { state, abort: new AbortController(), pauseGate: new PauseGate() };
        this.executions.set(executionId, handle);
        this.stateManager.saveState(state);
        this.hierarchyManagers.set(executionId, new HierarchyManager(team.agents));
        this.messageBus.publish({ type: "execution:started", executionId });

        const result = this.runToCompletion(team, task, executionId, state, handle);
        return { executionId, result };
    }

    private async runToCompletion(
        team: TeamConfig,
        task: string,
        executionId: string,
        state: ExecutionState,
        handle: ExecutionHandle
    ): Promise<TaskResult> {
        try {
            const result = await this.dispatch(team, task, handle);
            state.status = result.success ? "completed" : "failed";
            state.completedAt = new Date();
            this.messageBus.publish({ type: "execution:completed", executionId, result });
            return result;
        } catch (error) {
            if (error instanceof ExecutionCancelledError) {
                state.status = "cancelled";
                state.completedAt = new Date();
                return {
                    success: false,
                    output: "",
                    artifacts: [],
                    metrics: { ...EMPTY_METRICS },
                    error: error.message,
                };
            }
            state.status = "failed";
            state.completedAt = new Date();
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, output: "", artifacts: [], metrics: { ...EMPTY_METRICS }, error: message };
        }
    }

    private async dispatch(team: TeamConfig, task: string, handle: ExecutionHandle): Promise<TaskResult> {
        const protocol: ProtocolType = team.protocol.type;
        switch (protocol) {
            case "hierarchical":
                return this.runHierarchical(team, task, handle);
            case "pipeline":
                return this.runPipeline(team, task, handle);
            case "swarm":
                return this.runSwarm(team, task, handle);
            case "debate":
                return this.runDebate(team, task, handle);
            case "round-robin":
                return this.runRoundRobin(team, task, handle);
            default: {
                const exhaustive: never = protocol;
                throw new Error(`Unknown protocol: ${exhaustive}`);
            }
        }
    }

    /** Checked between every step of every protocol loop below. */
    private async checkpoint(handle: ExecutionHandle): Promise<void> {
        await handle.pauseGate.wait();
        if (handle.abort.signal.aborted) throw new ExecutionCancelledError(handle.state.id);
    }

    private coordinatorAgent(team: TeamConfig): AgentDefinition {
        const agent = team.agents.find((a) => a.id === team.coordinatorId);
        if (!agent) throw new Error(`Team ${team.name} has no agent matching coordinatorId ${team.coordinatorId}`);
        return agent;
    }

    private specialists(team: TeamConfig): AgentDefinition[] {
        return team.agents.filter((a) => a.id !== team.coordinatorId);
    }

    private async runAgentStep(agent: AgentDefinition, prompt: string, handle: ExecutionHandle): Promise<TaskResult> {
        await this.checkpoint(handle);
        const result = await this.executor.run(agent, prompt, handle.state, {
            abortSignal: handle.abort.signal,
        });
        this.stateManager.createCheckpoint(handle.state, agent.id || agent.name, handle.state.id, `${agent.role} step completed`);
        return result;
    }

    // -----------------------------------------------------------------
    // Hierarchical: coordinator decomposes -> specialists execute subtasks
    // (bounded by maxParallelAgents) -> coordinator synthesizes.
    // -----------------------------------------------------------------
    private async runHierarchical(team: TeamConfig, task: string, handle: ExecutionHandle): Promise<TaskResult> {
        const coordinator = this.coordinatorAgent(team);
        const specialists = this.specialists(team);
        const decomposer = new TaskDecomposer(this.executor);
        const subtasks: SubTask[] = await decomposer.decompose(task, coordinator, handle.state);

        const assigner = new TaskAssigner();
        const assignments = assigner.assign(subtasks, specialists);
        const tracker = new TaskTracker();
        tracker.initialize(subtasks);

        const byId = new Map(specialists.map((a) => [a.id!, a]));
        const results: TaskResult[] = [];

        while (!tracker.isComplete()) {
            await this.checkpoint(handle);
            const ready = tracker.getReadyTasks().slice(0, Math.max(1, team.maxParallelAgents));
            if (ready.length === 0) break; // dependency deadlock — stop rather than spin forever

            const batch = await Promise.all(
                ready.map(async (subtask) => {
                    tracker.setStatus(subtask.id, "in-progress");
                    const agentId = assignments.get(subtask.id);
                    const agent = agentId ? byId.get(agentId) : undefined;
                    if (!agent) {
                        const failed: TaskResult = {
                            success: false,
                            output: "",
                            artifacts: [],
                            metrics: { ...EMPTY_METRICS },
                            error: `No agent assigned for subtask ${subtask.id}`,
                        };
                        tracker.setResult(subtask.id, failed);
                        return failed;
                    }
                    const prompt = `${subtask.title}\n\n${subtask.description}`;
                    const result = await this.runAgentStep(agent, prompt, handle);
                    tracker.setResult(subtask.id, result);
                    return result;
                })
            );
            results.push(...batch);
        }

        const synthesis = subtasks
            .map((st, i) => `## ${st.title}\n${st.result?.output ?? "(no output)"}`)
            .join("\n\n");
        const synthesisPrompt =
            `Original task:\n${task}\n\nSubtask reports:\n${synthesis}\n\n` +
            `Synthesize these into one final result for the original task.`;
        const finalResult = await this.runAgentStep(coordinator, synthesisPrompt, handle);

        return {
            success: results.every((r) => r.success) && finalResult.success,
            output: finalResult.output,
            artifacts: [...results.flatMap((r) => r.artifacts), ...finalResult.artifacts],
            metrics: mergeMetrics([...results, finalResult]),
        };
    }

    // -----------------------------------------------------------------
    // Pipeline: specialists run in order, each sees the previous output.
    // pipelineOrder is a list of agent names; empty means "auto-order by
    // role" per the comment on registry.ts's code-review-squad template.
    // -----------------------------------------------------------------
    private static readonly PIPELINE_ROLE_ORDER = ["architect", "coder", "reviewer", "tester", "documenter"];

    private async runPipeline(team: TeamConfig, task: string, handle: ExecutionHandle): Promise<TaskResult> {
        const specialists = this.specialists(team);
        const order = team.protocol.pipelineOrder?.length
            ? team.protocol.pipelineOrder
                  .map((name) => specialists.find((a) => a.name === name))
                  .filter((a): a is AgentDefinition => Boolean(a))
            : ArenaCoordinator.PIPELINE_ROLE_ORDER.flatMap((role) => specialists.filter((a) => a.role === role));

        if (order.length === 0) throw new Error(`Team ${team.name} has no agents to run in pipeline order`);

        const results: TaskResult[] = [];
        let runningOutput = task;
        for (const agent of order) {
            await this.checkpoint(handle);
            const prompt =
                results.length === 0
                    ? task
                    : `Original task:\n${task}\n\nPrevious stage output (from ${order[results.length - 1]!.role}):\n${runningOutput}\n\nContinue the pipeline as the ${agent.role}.`;
            const result = await this.runAgentStep(agent, prompt, handle);
            results.push(result);
            runningOutput = result.output;
        }

        // order.length === 0 is rejected above, and this loop runs once per
        // entry in order, so results.length === order.length > 0 here.
        const last = results[results.length - 1]!;
        return {
            success: results.every((r) => r.success),
            output: last.output,
            artifacts: results.flatMap((r) => r.artifacts),
            metrics: mergeMetrics(results),
        };
    }

    // -----------------------------------------------------------------
    // Swarm: N specialists attempt the same task in parallel, coordinator
    // judges and picks the winner.
    // -----------------------------------------------------------------
    private async runSwarm(team: TeamConfig, task: string, handle: ExecutionHandle): Promise<TaskResult> {
        const coordinator = this.coordinatorAgent(team);
        const specialists = this.specialists(team);
        const count = team.protocol.agentCount ?? specialists.length;
        const contestants = specialists.slice(0, count);
        if (contestants.length === 0) throw new Error(`Team ${team.name} has no agents to run in the swarm`);

        await this.checkpoint(handle);
        const attempts = await Promise.all(contestants.map((agent) => this.runAgentStep(agent, task, handle)));

        const entries = attempts
            .map((r, i) => `## Attempt ${i + 1} (${contestants[i]!.name})\n${r.success ? r.output : `FAILED: ${r.error}`}`)
            .join("\n\n");
        const judgePrompt =
            `Original task:\n${task}\n\n${entries}\n\n` +
            `Pick the single best attempt. Reply with the winning attempt's full output only — ` +
            `no commentary about which one you picked.`;
        const verdict = await this.runAgentStep(coordinator, judgePrompt, handle);

        return {
            success: attempts.some((r) => r.success) && verdict.success,
            output: verdict.output,
            artifacts: [...attempts.flatMap((r) => r.artifacts), ...verdict.artifacts],
            metrics: mergeMetrics([...attempts, verdict]),
        };
    }

    // -----------------------------------------------------------------
    // Debate: two (or more) specialists argue for debateRounds rounds,
    // coordinator moderates and delivers a final verdict.
    // -----------------------------------------------------------------
    private async runDebate(team: TeamConfig, task: string, handle: ExecutionHandle): Promise<TaskResult> {
        const coordinator = this.coordinatorAgent(team);
        const debaters = this.specialists(team);
        if (debaters.length < 2) throw new Error(`Debate protocol needs at least 2 specialists, team ${team.name} has ${debaters.length}`);

        const rounds = team.protocol.debateRounds ?? 3;
        const transcript: string[] = [];
        const results: TaskResult[] = [];

        for (let round = 0; round < rounds; round++) {
            for (const debater of debaters) {
                await this.checkpoint(handle);
                const prompt =
                    `Topic:\n${task}\n\n` +
                    (transcript.length ? `Debate so far:\n${transcript.join("\n\n")}\n\n` : "") +
                    `Round ${round + 1}: give your position as ${debater.name} (${debater.role}).`;
                const result = await this.runAgentStep(debater, prompt, handle);
                results.push(result);
                transcript.push(`[${debater.name}, round ${round + 1}]\n${result.output}`);
            }
        }

        const verdictPrompt =
            `Topic:\n${task}\n\nFull debate transcript:\n${transcript.join("\n\n")}\n\n` +
            `As moderator, deliver the final decision and a short justification.`;
        const verdict = await this.runAgentStep(coordinator, verdictPrompt, handle);

        return {
            success: results.every((r) => r.success) && verdict.success,
            output: verdict.output,
            artifacts: [...results.flatMap((r) => r.artifacts), ...verdict.artifacts],
            metrics: mergeMetrics([...results, verdict]),
        };
    }

    // -----------------------------------------------------------------
    // Round-robin: specialists take turns refining a shared draft for
    // maxTurns turns. No judging step — the last turn's output wins.
    // -----------------------------------------------------------------
    private async runRoundRobin(team: TeamConfig, task: string, handle: ExecutionHandle): Promise<TaskResult> {
        const specialists = this.specialists(team);
        if (specialists.length === 0) throw new Error(`Team ${team.name} has no agents for round-robin`);

        const maxTurns = team.protocol.maxTurns ?? specialists.length;
        const results: TaskResult[] = [];
        let draft = task;

        for (let turn = 0; turn < maxTurns; turn++) {
            // specialists.length === 0 is rejected above, so this modulo
            // index is always in range.
            const agent = specialists[turn % specialists.length]!;
            await this.checkpoint(handle);
            const prompt =
                turn === 0
                    ? task
                    : `Original task:\n${task}\n\nCurrent draft (from ${specialists[(turn - 1) % specialists.length]!.name}):\n${draft}\n\nImprove it as ${agent.name} (${agent.role}).`;
            const result = await this.runAgentStep(agent, prompt, handle);
            results.push(result);
            draft = result.output;
        }

        // maxTurns is always >= 1 here (defaults to specialists.length,
        // which is > 0), so results has at least one entry.
        const last = results[results.length - 1]!;
        return {
            success: results.every((r) => r.success),
            output: last.output,
            artifacts: results.flatMap((r) => r.artifacts),
            metrics: mergeMetrics(results),
        };
    }

    // -----------------------------------------------------------------
    // Lifecycle controls
    // -----------------------------------------------------------------

    getExecutionStatus(executionId: string): ExecutionState | undefined {
        return this.executions.get(executionId)?.state;
    }

    pauseExecution(executionId: string): boolean {
        const handle = this.executions.get(executionId);
        if (!handle || handle.state.status !== "running") return false;
        handle.pauseGate.pause();
        handle.state.status = "paused";
        this.messageBus.publish({ type: "execution:paused", executionId });
        return true;
    }

    resumeExecution(executionId: string): boolean {
        const handle = this.executions.get(executionId);
        if (!handle || handle.state.status !== "paused") return false;
        handle.pauseGate.resume();
        handle.state.status = "running";
        this.messageBus.publish({ type: "execution:resumed", executionId });
        return true;
    }

    cancelExecution(executionId: string): boolean {
        const handle = this.executions.get(executionId);
        if (!handle) return false;
        if (handle.state.status === "completed" || handle.state.status === "cancelled") return false;
        handle.abort.abort();
        handle.pauseGate.resume(); // unblock a paused loop so it can observe the abort
        this.messageBus.publish({ type: "execution:cancelled", executionId });
        return true;
    }
}
