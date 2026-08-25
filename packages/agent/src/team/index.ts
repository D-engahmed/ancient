export { TeamBuilder } from "./builder";
export { TemplateRegistry, defaultRegistry, BUILTIN_TEMPLATES } from "./registry";
export { HierarchyManager } from "./hierarchy";
export {
    ROLE_DEFINITIONS,
    getRoleConfig,
    getDefaultSystemPrompt,
    getDefaultCapabilities,
    getDefaultTools,
    getPreferredModels,
    canDelegate,
    getMaxDelegationDepth,
} from "./roles";

export type { AgentTemplate, ModelOverrides } from "./registry";
export type { AgentBuilderConfig } from "./builder";