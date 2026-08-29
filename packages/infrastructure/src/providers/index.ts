// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.

export type { ProviderConnection } from "./connection";
export { ProviderKeyCipher, cipherFromEnv } from "./connection";

export {
    modelKey,
    checkCooldown,
    recordRateLimitFailure,
    RateLimitCooldownError,
    isRateLimitError,
} from "./breaker";
export type { CooldownStatus } from "./breaker";

export { asFallbackCandidate, pickHealthyFallback } from "./fallback";
export type { FallbackCandidate } from "./fallback";

export { classifyPrompt, routeTurn } from "./router";
export type { RouteDecision } from "./router";
export type { ModelRoutingSettings } from "./routing-settings";

export { pricingFor, costFor, sumCosts } from "./cost";
export type { CostEstimate, UsageTokens, CostBreakdown } from "./cost";
