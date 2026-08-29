// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Tool-call approval & consent gating (infrastructure/security).
//
// Decides whether an agent may perform a given operation (read / write / exec /
// network / path / scope). Keeps the policy pure (no I/O) so it is unit-testable
// and reusable by the capability runtime and engine. This is the consent boundary
// for risky tool calls: an operation is allowed, denied, or gated behind explicit
// user consent on the approval bus.

export type RiskCategory =
    | "read"
    | "write"
    | "exec"
    | "network"
    | "scope";

export type ApprovalDecision = "allow" | "deny" | "require-consent";

export type ToolRequest = {
    name: string;
    category: RiskCategory;
    /** Resolvable target, e.g. an absolute path, host, or scope id. */
    target?: string;
    /** Verbatim caller-provided reason for the operation. */
    reason?: string;
};

export type ApprovalRule = {
    category: RiskCategory;
    decision: ApprovalDecision;
    /** Optional glob-ish include/exclude over the target. */
    targetPattern?: string;
};

/** A resolved, ctx-independent decision for a single request. */
export type Approval = {
    decision: ApprovalDecision;
    reason: string;
};

/** Policy: a list of rules applied in order; the first match wins. */
export class ApprovalPolicy {
    #rules: ApprovalRule[];

    /** Default policy: reads/allow, scope/require, everything else deny. */
    constructor(rules: ApprovalRule[] = [
        { category: "read", decision: "allow" },
        { category: "scope", decision: "require-consent" },
        { category: "exec", decision: "deny" },
        { category: "write", decision: "deny" },
        { category: "network", decision: "deny" },
    ]) {
        this.#rules = rules;
    }

    evaluate(request: ToolRequest): Approval {
        const rule = this.#rules.find(
            (r) =>
                r.category === request.category &&
                (r.targetPattern === undefined ||
                    this.#matches(request.target ?? "", r.targetPattern)),
        );

        if (!rule) {
            return { decision: "deny", reason: `no rule for category '${request.category}'` };
        }

        const base = rule.decision;
        if (base === "allow") {
            return { decision: "allow", reason: `rule allows ${request.category}` };
        }
        if (base === "deny") {
            return {
                decision: "deny",
                reason: `rule denies ${request.category}${request.target ? ` '${request.target}'` : ""}`,
            };
        }
        return {
            decision: "require-consent",
            reason: `consent required for ${request.category}${request.target ? ` '${request.target}'` : ""}`,
        };
    }

    /** Grant an ad-hoc allow override for a categorical request (e.g. a one-shot rule). */
    allow(category: RiskCategory): this {
        this.#rules = [{ category, decision: "allow" }, ...this.#rules];
        return this;
    }

    #matches(target: string, pattern: string): boolean {
        // * matches any run of chars (including none); ** matches across '/'.
        const re = new RegExp(
            "^" +
                pattern
                    .split("*")
                    .map((seg) => seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
                    .join(".*") +
                "$",
        );
        return re.test(target);
    }
}
