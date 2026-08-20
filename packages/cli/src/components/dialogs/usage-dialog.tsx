// packages/cli/src/components/dialogs/usage-dialog.tsx
import { useEffect, useState } from "react";
import { TextAttributes } from "@opentui/core";
import { useTheme } from "../../providers/theme";
import { apiClient } from "../../lib/api-client";

type ConnectionUsage = {
    connectionId: string;
    label: string;
    modelId: string;
    used: number;
    limit: number | null;
    limitKnown: boolean;
    windowSeconds: number;
    windowAssumed: boolean;
    metric: string | null;
    resetAt: string | null;
};

const BAR_WIDTH = 24;

function formatWindow(seconds: number): string {
    if (seconds % 86400 === 0) return seconds === 86400 ? "day" : `${seconds / 86400}d`;
    if (seconds % 3600 === 0) return seconds === 3600 ? "hour" : `${seconds / 3600}h`;
    if (seconds % 60 === 0) return seconds === 60 ? "minute" : `${seconds / 60}m`;
    return `${seconds}s`;
}

function formatResetIn(resetAt: string | null): string | null {
    if (!resetAt) return null;
    const ms = new Date(resetAt).getTime() - Date.now();
    if (ms <= 0) return "resets any moment";
    const totalSeconds = Math.round(ms / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    if (h > 0) return `resets in ${h}h ${m}m`;
    if (m > 0) return `resets in ${m}m ${s}s`;
    return `resets in ${s}s`;
}

// "·" for unknown-limit connections — an honest "we don't know the ceiling
// yet" rather than a fabricated percentage.
function renderBar(used: number, limit: number | null): string {
    if (!limit || limit <= 0) return "·".repeat(BAR_WIDTH);
    const ratio = Math.min(1, used / limit);
    const filled = Math.round(ratio * BAR_WIDTH);
    return "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
}

function barColor(used: number, limit: number | null, colors: ReturnType<typeof useTheme>["colors"]): string {
    if (!limit || limit <= 0) return colors.dimSeparator;
    const ratio = used / limit;
    if (ratio >= 0.8) return colors.error;
    return colors.success;
}

export const UsageDialogContent = () => {
    const { colors } = useTheme();
    const [usages, setUsages] = useState<ConnectionUsage[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let ignore = false;
        apiClient.usage
            .list()
            .then((data: ConnectionUsage[]) => {
                if (!ignore) setUsages(data);
            })
            .catch((err: unknown) => {
                if (!ignore) setError(err instanceof Error ? err.message : "Failed to load usage");
            });
        return () => {
            ignore = true;
        };
    }, []);

    if (error) {
        return (
            <box flexDirection="column">
                <text fg={colors.error}>{error}</text>
            </box>
        );
    }

    if (!usages) {
        return (
            <box flexDirection="column">
                <text attributes={TextAttributes.DIM}>Loading usage...</text>
            </box>
        );
    }

    if (usages.length === 0) {
        return (
            <box flexDirection="column">
                <text attributes={TextAttributes.DIM}>
                    No custom connections yet — usage tracking applies to BYOK connections added via /models.
                </text>
            </box>
        );
    }

    return (
        <box flexDirection="column" gap={1}>
            <text attributes={TextAttributes.DIM}>
                Requests seen per connection in its current window. A limit fills in automatically the first
                time that provider reports one via a 429.
            </text>
            {usages.map((u) => {
                const resetLabel = formatResetIn(u.resetAt);
                return (
                    <box key={u.connectionId} flexDirection="column">
                        <box flexDirection="row" gap={1}>
                            <text attributes={TextAttributes.BOLD}>{u.label}</text>
                            <text attributes={TextAttributes.DIM}>{u.modelId}</text>
                        </box>
                        <box flexDirection="row" gap={1}>
                            <text fg={barColor(u.used, u.limit, colors)}>{renderBar(u.used, u.limit)}</text>
                            <text attributes={TextAttributes.DIM}>
                                {u.limitKnown
                                    ? `${u.used} / ${u.limit} per ${formatWindow(u.windowSeconds)}${u.windowAssumed ? " (assumed)" : ""}`
                                    : `${u.used} request${u.used === 1 ? "" : "s"} this window — limit unknown until a rate-limit response is seen`}
                            </text>
                        </box>
                        {resetLabel && <text attributes={TextAttributes.DIM}>{resetLabel}</text>}
                    </box>
                );
            })}
        </box>
    );
};
