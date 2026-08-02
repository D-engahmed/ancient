import { useState, useCallback, useMemo } from "react";
import { TextAttributes } from "@opentui/core";
import { useDialog } from "../../providers/dialog";
import { useToast } from "../../providers/toast";
import { apiClient } from "../../lib/api-client";
import { getErrorMessage } from "../../lib/http-errors";
import { DialogSearchList } from "../dialog-search-list";
import type { Provider } from "./provider-selection-dialog";

type Props = {
    provider: Provider;
};

export const AddProviderConnectionDialog = ({ provider }: Props) => {
    const dialog = useDialog();
    const toast = useToast();

    const [label, setLabel] = useState(
        provider.defaultModelId
            ? `${provider.label} (${provider.defaultModelId})`
            : provider.label,
    );
    const [baseUrl, setBaseUrl] = useState(provider.defaultBaseUrl);
    const [modelId, setModelId] = useState(provider.defaultModelId);
    const [apiKey, setApiKey] = useState("");
    const [submitting, setSubmitting] = useState(false);

    // Model options from provider list, plus a custom option
    const modelOptions = useMemo(() => {
        const models = provider.models || [];
        // If no models defined, add a placeholder
        if (models.length === 0) {
            return [{ id: "", label: "Custom model ID" }];
        }
        return models;
    }, [provider]);

    // When user selects a model from the list, update modelId and optionally label
    const handleSelectModel = useCallback(
        (selected: typeof modelOptions[number]) => {
            setModelId(selected.id);
            // Auto‑update label to include the model name if it's not custom
            if (selected.id) {
                setLabel(`${provider.label} (${selected.id})`);
            }
        },
        [provider],
    );

    const handleSubmit = useCallback(async () => {
        if (!label.trim() || !baseUrl.trim() || !modelId.trim()) {
            toast.show({ variant: "error", message: "Label, base URL, and model ID are required" });
            return;
        }

        setSubmitting(true);
        try {
            const res = await apiClient["provider-connections"].$post({
                json: {
                    label: label.trim(),
                    protocol: provider.protocol,
                    baseUrl: baseUrl.trim(),
                    modelId: modelId.trim(),
                    apiKey,
                },
            });
            if (!res.ok) {
                const error = await getErrorMessage(res);
                throw new Error(error);
            }
            toast.show({ variant: "success", message: "Connection added successfully" });
            dialog.close();
        } catch (error) {
            toast.show({
                variant: "error",
                message: error instanceof Error ? error.message : "Failed to add connection",
            });
        } finally {
            setSubmitting(false);
        }
    }, [label, baseUrl, modelId, apiKey, provider]);

    return (
        <box flexDirection="column" gap={1} width="100%">
            {/* Label */}
            <box flexDirection="column">
                <text attributes={TextAttributes.DIM}>Label</text>
                <input
                    placeholder="e.g. My OpenAI Key"
                    value={label}
                    onInput={(value) => setLabel(value)}
                />
            </box>

            {/* Protocol (read‑only) */}
            <box flexDirection="column">
                <text attributes={TextAttributes.DIM}>Protocol</text>
                <box flexDirection="row" gap={1}>
                    <text>{provider.protocol}</text>
                </box>
            </box>

            {/* Base URL */}
            <box flexDirection="column">
                <text attributes={TextAttributes.DIM}>Base URL</text>
                <input
                    placeholder="https://api.openai.com/v1"
                    value={baseUrl}
                    onInput={(value) => setBaseUrl(value)}
                />
            </box>

            {/* Model selection – dropdown/list */}
            <box flexDirection="column">
                <text attributes={TextAttributes.DIM}>Choose a preset model (optional)</text>
                <box maxHeight={6} overflow="hidden">
                    <DialogSearchList
                        items={modelOptions}
                        onSelect={handleSelectModel}
                        filterFn={(item, query) =>
                            item.label.toLowerCase().includes(query.toLowerCase()) ||
                            item.id.toLowerCase().includes(query.toLowerCase())
                        }
                        renderItem={(item, isSelected) => (
                            <box
                                flexDirection="row"
                                flexGrow={1}
                                overflow="hidden"
                                width="100%"
                            >
                                <text selectable={false} fg={isSelected ? "black" : "white"}>
                                    {item.label}
                                </text>
                                {item.id && (
                                    <>
                                        <box flexGrow={1} />
                                        <text
                                            selectable={false}
                                            attributes={TextAttributes.DIM}
                                            fg={isSelected ? "black" : undefined}
                                        >
                                            {item.id}
                                        </text>
                                    </>
                                )}
                            </box>
                        )}
                        getKey={(item) => item.id || "custom"}
                        placeholder="Type to filter models"
                        emptyText="No matching models"
                    />
                </box>
            </box>

            <box flexDirection="column">
                <text attributes={TextAttributes.DIM}>Model ID</text>
                <input
                    placeholder="Type any model ID, or select a preset above"
                    value={modelId}
                    onInput={(value) => setModelId(value)}
                />
            </box>

            {/* API Key */}
            <box flexDirection="column">
                <text attributes={TextAttributes.DIM}>API Key (optional for local servers)</text>
                <input
                    placeholder={provider.id === "ollama" || provider.id === "lmstudio" || provider.id === "vllm" ? "Not needed for most local servers" : "sk-..."}
                    type="password"
                    value={apiKey}
                    onInput={(value) => setApiKey(value)}
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
