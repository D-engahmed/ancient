// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
// file: packages/server/src/lib/dangerous-commands.ts

// Defense-in-depth only. This is NOT a substitute for a real approval gate —
// it's a floor that blocks the handful of one-liners that cause irreversible
// damage before any human ever sees them. A determined or unlucky model can
// still phrase around a regex denylist; this exists to catch the common,
// catastrophic cases (accidental or prompt-injected), not to sandbox
// arbitrary shell input.
const DANGEROUS_PATTERNS: { pattern: RegExp; reason: string }[] = [
    { pattern: /\brm\s+(-\w*r\w*f\w*|-\w*f\w*r\w*)\s+(\/|~|\$HOME|\.\.\/*\s*$)/i, reason: "recursive force-delete of root, home, or a parent directory" },
    { pattern: /\bgit\s+push\s+.*--force\b.*\b(main|master)\b/i, reason: "force-push to main/master" },
    { pattern: /\bgit\s+reset\s+--hard\b/i, reason: "hard reset (discards uncommitted work)" },
    { pattern: /\bcurl\b[^|]*\|\s*(sudo\s+)?(sh|bash|zsh)\b/i, reason: "piping a downloaded script directly into a shell" },
    { pattern: /\bwget\b[^|]*\|\s*(sudo\s+)?(sh|bash|zsh)\b/i, reason: "piping a downloaded script directly into a shell" },
    { pattern: /\bmkfs\b/i, reason: "formatting a filesystem" },
    { pattern: /\bdd\s+.*\bof=\/dev\/(sd|nvme|hd)/i, reason: "writing raw bytes over a block device" },
    { pattern: /:\(\)\{.*\|.*&.*\};:/, reason: "fork bomb" },
    { pattern: /\bchmod\s+-R\s+777\s+\//i, reason: "recursively opening permissions on root" },
    { pattern: /\bsudo\s+rm\b/i, reason: "elevated delete" },
];

export function findDangerousCommandMatch(command: string): string | null {
    for (const { pattern, reason } of DANGEROUS_PATTERNS) {
        if (pattern.test(command)) {
            return reason;
        }
    }
    return null;
}
