// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Secret redaction (infrastructure/security).
//
// Masks secrets and sensitive values in logs, tool output, and prompts so they
// never leak to disk, terminals, or upstream. Kept dependency-light: pure regex
// matching over configured patterns. Provider keys themselves are handled by
// providers/connection.ts (ProviderKeyCipher) — this module protects the *text*
// streams those keys (and other secrets) flow through.
//
// Two classes of patterns:
//   - prefixed secrets — recognizable by their prefix (sk-…, ghp_…, AKIA…, Bearer …);
//   - labeled values — `label=value` pairs for common secret labels (api_key, token,
//     password, secret). Replacements may reference capture groups.

export type SensitivePattern = {
    /** Short label used in the masked marker, e.g. "api-key". */
    name: string;
    /** Full-match expression covering the entire secret (prefix / key+value). */
    regex: RegExp;
    /** Replacement shown in place of the matched secret. May use $1-style groups. */
    replacement?: string;
};

export const DEFAULT_SECRET_PATTERNS: SensitivePattern[] = [
    {
        name: "bearer",
        regex: /\b([Bb]earer\s+)[A-Za-z0-9._~+/=_-]+/,
        replacement: "$1[REDACTED]",
    },
    {
        name: "sk",
        regex: /\bsk-[A-Za-z0-9]{8,}\b/,
        replacement: "sk-[REDACTED]",
    },
    {
        name: "aws",
        regex: /\bAKIA[0-9A-Z]{16}\b/,
        replacement: "AKIA[REDACTED]",
    },
    {
        name: "github",
        regex: /\b(?:ghp|gho|github_pat)_[A-Za-z0-9_]{20,}\b/i,
        replacement: "[REDACTED]",
    },
    {
        name: "labeled",
        regex: /\b((?:api[_-]?key|password|passwd|secret|token))\s*[:=]\s*(?!\[REDACTED\])\S+/i,
        replacement: "$1=[REDACTED]",
    },
];

export type RedactionResult = {
    text: string;
    redacted: string[];
    changed: boolean;
};

/** Builds a redactor bound to a fixed set of patterns. */
export class Redactor {
    readonly #patterns: SensitivePattern[];

    constructor(patterns: SensitivePattern[] = DEFAULT_SECRET_PATTERNS) {
        this.#patterns = patterns;
    }

    /**
     * Redact any secrets found in `text`. Returns the masked text plus the list
     * of pattern names that hit (for logging/tests) and a `changed` flag.
     */
    redact(text: string): RedactionResult {
        let output = text;
        const redacted: string[] = [];
        for (const p of this.#patterns) {
            const flags = p.regex.flags.includes("g") ? p.regex.flags : p.regex.flags + "g";
            const global = new RegExp(p.regex.source, flags);
            const before = output;
            const after = output.replace(global, p.replacement ?? "[REDACTED]");
            if (after !== before) {
                output = after;
                redacted.push(p.name);
            }
        }
        return {
            text: output,
            redacted: [...new Set(redacted)],
            changed: redacted.length > 0,
        };
    }

    /** Convenience: returns only the masked text. */
    mask(text: string): string {
        return this.redact(text).text;
    }
}