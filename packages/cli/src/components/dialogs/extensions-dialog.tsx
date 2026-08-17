// file: packages/cli/src/components/dialogs/extensions-dialog.tsx
// Dialogs for the extension systems: skills, subagents, prompt commands,
// MCP servers, and checkpoints/rewind.

import { useEffect, useState } from "react";
import { TextAttributes } from "@opentui/core";
import { useDialog } from "../../providers/dialog";
import { useToast } from "../../providers/toast";
import { apiClient } from "../../lib/api-client";
import { DialogSearchList } from "../dialog-search-list";

type Row = {
    id: string;
    title: string;
    detail?: string;
    badge?: string;
    payload?: unknown;
};

function ExtensionListDialog(props: {
    load: () => Promise<Row[]>;
    onSelect?: (row: Row) => void;
    emptyText: string;
    errorMessage: string;
}) {
    const [rows, setRows] = useState<Row[]>([]);
    const [loading, setLoading] = useState(true);
    const { close } = useDialog();
    const { show } = useToast();

    useEffect(() => {
        let ignore = false;
        props
            .load()
            .then((data) => {
                if (!ignore) {
                    setRows(data);
                    setLoading(false);
                }
            })
            .catch((error) => {
                if (!ignore) {
                    show({
                        variant: "error",
                        message: error instanceof Error ? error.message : props.errorMessage,
                    });
                    close();
                }
            });
        return () => {
            ignore = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (loading) {
        return (
            <box flexDirection="column">
                <text attributes={TextAttributes.DIM}>Loading...</text>
            </box>
        );
    }

    return (
        <DialogSearchList
            items={rows}
            onSelect={(row) => {
                if (props.onSelect) {
                    props.onSelect(row);
                } else {
                    close();
                }
            }}
            filterFn={(row, query) =>
                row.title.toLowerCase().includes(query.toLowerCase()) ||
                (row.detail ?? "").toLowerCase().includes(query.toLowerCase())
            }
            renderItem={(row, isSelected) => (
                <>
                    <text selectable={false} fg={isSelected ? "black" : "white"}>
                        {row.title}
                    </text>
                    {row.badge && (
                        <text selectable={false} fg={isSelected ? "black" : "cyan"}>
                            {" "}[{row.badge}]
                        </text>
                    )}
                    <box flexGrow={1} />
                    {row.detail && (
                        <text selectable={false} fg={isSelected ? "black" : undefined} attributes={TextAttributes.DIM}>
                            {row.detail.length > 40 ? row.detail.slice(0, 40) + "…" : row.detail}
                        </text>
                    )}
                </>
            )}
            getKey={(row) => row.id}
            placeholder="Type to filter"
            emptyText={props.emptyText}
        />
    );
}

export const SkillsDialogContent = ({ cwd }: { cwd?: string }) => (
    <ExtensionListDialog
        load={async () =>
            (await apiClient.extensions.skills(cwd)).map((s: any) => ({
                id: s.name,
                title: s.name,
                detail: s.description,
                badge: s.source,
            }))
        }
        emptyText="No skills installed — add SKILL.md folders to .ancient/skills/"
        errorMessage="Failed to load skills"
    />
);

export const AgentsDialogListContent = ({ cwd }: { cwd?: string }) => (
    <ExtensionListDialog
        load={async () =>
            (await apiClient.extensions.agents(cwd)).map((a: any) => ({
                id: a.name,
                title: a.name,
                detail: a.description,
                badge: a.source,
            }))
        }
        emptyText="No agents found — add markdown files to .ancient/agents/"
        errorMessage="Failed to load agents"
    />
);

export const CommandsDialogContent = ({ cwd }: { cwd?: string }) => (
    <ExtensionListDialog
        load={async () =>
            (await apiClient.extensions.commands(cwd)).map((c: any) => ({
                id: c.name,
                title: `/${c.name}`,
                detail: c.description,
                badge: c.source,
            }))
        }
        emptyText="No prompt commands found — add markdown files to .ancient/commands/"
        errorMessage="Failed to load commands"
    />
);

export const McpDialogContent = ({ cwd }: { cwd?: string }) => (
    <ExtensionListDialog
        load={async () =>
            (await apiClient.extensions.mcpServers(cwd)).map((s: any) => ({
                id: s.name,
                title: s.name,
                detail: s.connected ? `${s.toolCount} tools` : (s.error ?? "unavailable"),
                badge: s.connected ? "connected" : "offline",
            }))
        }
        emptyText="No MCP servers configured — add them to .mcp.json"
        errorMessage="Failed to load MCP servers"
    />
);

export const CheckpointsDialogContent = ({ sessionId }: { sessionId: string }) => {
    const { close } = useDialog();
    const { show } = useToast();

    return (
        <ExtensionListDialog
            load={async () =>
                (await apiClient.extensions.checkpoints(sessionId)).map((cp: any) => ({
                    id: cp.id,
                    title: `${cp.id} — ${cp.label || "checkpoint"}`,
                    detail: new Date(cp.createdAt).toLocaleString(),
                    payload: cp,
                }))
            }
            onSelect={async (row) => {
                try {
                    const result = await apiClient.extensions.rewind(sessionId, row.id);
                    show({
                        variant: "success",
                        message: `Rewound to ${row.id} (${result.deletedMessages ?? 0} messages removed). Reopen the session to see the trimmed history.`,
                    });
                } catch (error) {
                    show({
                        variant: "error",
                        message: error instanceof Error ? error.message : "Rewind failed",
                    });
                }
                close();
            }}
            emptyText="No checkpoints yet — one is created before each BUILD turn"
            errorMessage="Failed to load checkpoints"
        />
    );
};
