/**
 * ANCIENT Agent System — Main Export
 * 
 * The most powerful sub-agent orchestration framework
 * ever built into an AI coding assistant.
 */

// Arena (Coordination)
export {
    ArenaCoordinator,
    MessageBus,
    HierarchicalDelegation,
    ConsensusProtocol,
    PipelineProtocol,
    SwarmProtocol,
    DebateProtocol,
    RoundRobinProtocol,
} from "./arena";

// Team (Design)
export {
    TeamBuilder,
    TemplateRegistry,
    defaultRegistry,
    HierarchyManager,
    ROLE_DEFINITIONS,
    getRoleConfig,
    getDefaultSystemPrompt,
    getDefaultCapabilities,
    getDefaultTools,
    getPreferredModels,
    canDelegate,
    getMaxDelegationDepth,
} from "./team";

// Tasks (Work Management)
export {
    TaskDecomposer,
    TaskAssigner,
    TaskTracker,
} from "./tasks";

// Runtime (Execution)
export {
    ExecutionEngine,
    AgentExecutor,
    ExecutionScheduler,
    StateManager,
    ContextManager,
} from "./runtime";

// Backends (Model Routing)
export {
    BackendRouter,
    BackendFactory,
    BackendRegistry,
    defaultRegistry as defaultBackendRegistry,
} from "./backends";

// Types
export type * from "./types";