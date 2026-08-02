// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. 
// file: packages/cli/src/components/dialogs/add-connection-dialog.tsx

import { useState, useCallback } from "react";
import { TextAttributes } from "@opentui/core";
import { useDialog } from "../../providers/dialog";
import { useToast } from "../../providers/toast";
import { usePromptConfig } from "../../providers/prompt-config";
import { apiClient } from "../../lib/api-client";
import { getErrorMessage } from "../../lib/http-errors";

type FormState = {
    label: string;
    protocol: "openai" | "anthropic" | "gemini";
    baseUrl: string;
    modelId: string;
    apiKey: string;
};

export const AddConnectionDialogContent = () => {
    const dialog = useDialog();
    const toast = useToast();
    const { setModelSelection } = usePromptConfig();
    const [form, setForm] = useState<FormState>({
        label: "",
        protocol: "openai",
        baseUrl: "",
        modelId: "",
        apiKey: "",
    });
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = useCallback(async () => {
        if (!form.label.trim() || !form.baseUrl.trim() || !form.modelId.trim()) {
            toast.show({ variant: "error", message: "Label, base URL, and model ID are required" });
            return;
        }

        setSubmitting(true);
        try {
            const res = await apiClient["provider-connections"].$post({
                json: {
                    ...form,
                    label: form.label.trim(),
                    baseUrl: form.baseUrl.trim(),
                    modelId: form.modelId.trim(),
                },
            });
            if (!res.ok) {
                const error = await getErrorMessage(res);
                throw new Error(error);
            }
            const connection = await res.json() as { id: string };
            setModelSelection({ modelKind: "custom", connectionId: connection.id });
            toast.show({ variant: "success", message: "Connection added and selected" });
            dialog.close();
        } catch (error) {
            toast.show({
                variant: "error",
                message: error instanceof Error ? error.message : "Failed to add connection",
            });
        } finally {
            setSubmitting(false);
        }
    }, [form, setModelSelection]);

    const setProtocol = (protocol: FormState["protocol"]) => {
        setForm((f) => ({ ...f, protocol }));
    };

    return (
        <box flexDirection="column" gap={1}>
            {/* Label */}
            <box flexDirection="column">
                <text attributes={TextAttributes.DIM}>Label</text>
                <input
                    placeholder="e.g. My OpenAI Key"
                    value={form.label}
                    onInput={(value) => setForm((f) => ({ ...f, label: value }))}
                />
            </box>

            {/* Protocol - using clickable boxes instead of <select> */}
            <box flexDirection="column">
                <text attributes={TextAttributes.DIM}>Protocol</text>
                <box flexDirection="row" gap={1}>
                    {(["openai", "anthropic", "gemini"] as const).map((p) => {
                        const isActive = form.protocol === p;
                        return (
                            <box
                                key={p}
                                paddingX={1}
                                paddingY={0.5}
                                backgroundColor={isActive ? "blue" : undefined}
                                onMouseDown={() => setProtocol(p)}
                            >
                                <text selectable={false} fg={isActive ? "black" : "white"}>
                                    {p.charAt(0).toUpperCase() + p.slice(1)}
                                </text>
                            </box>
                        );
                    })}
                </box>
            </box>

            {/* Base URL */}
            <box flexDirection="column">
                <text attributes={TextAttributes.DIM}>Base URL</text>
                <input
                    placeholder="https://api.openai.com/v1"
                    value={form.baseUrl}
                    onInput={(value) => setForm((f) => ({ ...f, baseUrl: value }))}
                />
            </box>

            {/* Model ID */}
            <box flexDirection="column">
                <text attributes={TextAttributes.DIM}>Model ID</text>
                <input
                    placeholder="gpt-4, claude-3-opus, gemini-pro, ..."
                    value={form.modelId}
                    onInput={(value) => setForm((f) => ({ ...f, modelId: value }))}
                />
            </box>

            {/* API Key */}
            <box flexDirection="column">
                <text attributes={TextAttributes.DIM}>API Key (optional for local servers)</text>
                <input
                    placeholder="sk-..."
                    type="password"
                    value={form.apiKey}
                    onInput={(value) => setForm((f) => ({ ...f, apiKey: value }))}
                />
            </box>

            {/* Actions */}
            <box flexDirection="row" justifyContent="flex-end" gap={1} paddingTop={1}>
                <text attributes={TextAttributes.DIM} onMouseDown={() => dialog.close()}>
                    Cancel
                </text>
                <text
                    onMouseDown={handleSubmit}
                    attributes={submitting ? TextAttributes.DIM : undefined}
                >
                    {submitting ? "Adding..." : "Add"}
                </text>
            </box>
        </box>
    );
};
