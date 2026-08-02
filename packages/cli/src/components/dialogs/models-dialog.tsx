// copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. 
// file: packages/cli/src/components/dialogs/models-dialog.tsx

import { useCallback, useEffect, useState } from "react";
import { TextAttributes } from "@opentui/core";
import { useDialog } from "../../providers/dialog";
import { useToast } from "../../providers/toast";
import { usePromptConfig } from "../../providers/prompt-config";
import { apiClient } from "../../lib/api-client";
import { getErrorMessage } from "../../lib/http-errors";
import { DialogSearchList } from "../dialog-search-list";
import { SUPPORTED_CHAT_MODELS } from "@ANCIENT/shared";
import { ProviderSelectionDialog } from "./provider-selection-dialog";

type Connection = {
  id: string;
  label: string;
  protocol: string;
  modelId: string;
  keyLastFour: string;
};

export const ModelsDialogContent = () => {
  const dialog = useDialog();
  const { setModelSelection } = usePromptConfig();
  const toast = useToast();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ignore = false;
    const fetchConnections = async () => {
      try {
        const res = await apiClient["provider-connections"].$get();
        if (!res.ok) throw new Error(await getErrorMessage(res));
        const data = await res.json();
        if (!ignore) {
          setConnections(data);
          setLoading(false);
        }
      } catch (error) {
        if (!ignore) {
          toast.show({
            variant: "error",
            message: error instanceof Error ? error.message : "Failed to fetch connections",
          });
          dialog.close();
        }
      }
    };
    fetchConnections();
    return () => {
      ignore = true;
    };
  }, []);

  const builtinItems = SUPPORTED_CHAT_MODELS.map((m) => ({
    kind: "builtin" as const,
    id: m.id,
    label: m.id,
    provider: m.provider,
  }));

  const customItems = connections.map((c) => ({
    kind: "custom" as const,
    id: c.id,
    label: c.label,
    protocol: c.protocol,
    modelId: c.modelId,
    keyLastFour: c.keyLastFour,
  }));

  const allItems = [...builtinItems, ...customItems];

  const handleSelect = useCallback(
    (item: (typeof allItems)[number]) => {
      if (item.kind === "builtin") {
        setModelSelection({ modelKind: "builtin", modelId: item.id });
      } else {
        setModelSelection({ modelKind: "custom", connectionId: item.id });
      }
      dialog.close();
    },
    [setModelSelection, dialog],
  );

  const handleAddConnection = useCallback(() => {
    dialog.open({
      title: "Choose a Provider",
      children: <ProviderSelectionDialog />,
    });
  }, [dialog]);

  const filterFn = (item: (typeof allItems)[number], query: string) => {
    const search = query.toLowerCase();
    if (item.kind === "builtin") {
      return item.label.toLowerCase().includes(search);
    } else {
      return (
        item.label.toLowerCase().includes(search) ||
        item.modelId.toLowerCase().includes(search) ||
        item.protocol.toLowerCase().includes(search)
      );
    }
  };

  if (loading) {
    return (
      <box flexDirection="column">
        <text attributes={TextAttributes.DIM}>Loading models...</text>
      </box>
    );
  }

  return (
    <box flexDirection="column" gap={1}>
      <DialogSearchList
        items={allItems}
        onSelect={handleSelect}
        filterFn={filterFn}
        renderItem={(item, isSelected) => (
          <box flexDirection="row" flexGrow={1} overflow="hidden" width="100%">
            <text selectable={false} fg={isSelected ? "black" : "white"}>
              {item.kind === "builtin" ? item.label : item.label}
            </text>
            <box flexGrow={1} />
            <text
              selectable={false}
              attributes={TextAttributes.DIM}
              fg={isSelected ? "black" : undefined}
            >
              {item.kind === "builtin"
                ? item.provider
                : `${item.protocol} · ${item.modelId} (••••${item.keyLastFour})`}
            </text>
          </box>
        )}
        getKey={(item) => item.id}
        placeholder="Search models or custom connections"
        emptyText="No matching models or connections"
      />
      <box flexDirection="row" justifyContent="flex-end" paddingTop={1}>
        <text attributes={TextAttributes.DIM} onMouseDown={handleAddConnection}>
          + Add provider connection
        </text>
      </box>
    </box>
  );
};
