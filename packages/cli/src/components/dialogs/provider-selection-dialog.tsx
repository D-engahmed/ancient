// provider-selection-dialog.tsx
import { useCallback } from "react";
import { TextAttributes } from "@opentui/core";
import { useDialog } from "../../providers/dialog";
import { DialogSearchList } from "../dialog-search-list";
import { AddProviderConnectionDialog } from "./add-provider-connection-dialog";
import { PROVIDERS, type ProviderDefinition } from "@ANCIENT/shared";

export const ProviderSelectionDialog = () => {
    const dialog = useDialog();

    const handleSelect = useCallback(
        (provider: ProviderDefinition) => {
            dialog.open({
                title: `Add ${provider.label} Connection`,
                children: <AddProviderConnectionDialog provider={provider} />,
            });
        },
        [dialog],
    );

    return (
        <box flexDirection="column" gap={1}>
            <DialogSearchList
                items={PROVIDERS}
                onSelect={handleSelect}
                filterFn={(provider, query) =>
                    provider.label.toLowerCase().includes(query.toLowerCase()) ||
                    provider.description.toLowerCase().includes(query.toLowerCase()) ||
                    provider.id.toLowerCase().includes(query.toLowerCase())
                }
                renderItem={(provider, isSelected) => (
                    <box flexDirection="row" flexGrow={1} overflow="hidden" width="100%">
                        <text selectable={false} fg={isSelected ? "black" : "white"}>
                            {provider.label}
                        </text>
                        <box flexGrow={1} />
                        <text
                            selectable={false}
                            attributes={TextAttributes.DIM}
                            fg={isSelected ? "black" : undefined}
                        >
                            {provider.description}
                        </text>
                    </box>
                )}
                getKey={(provider) => provider.id}
                placeholder="Search providers (OpenAI, Anthropic, ...)"
                emptyText="No matching providers"
            />
        </box>
    );
};