// packages/cli/src/components/dialogs/models-dialog.tsx
import { useCallback, useEffect, useState, useMemo } from "react";
import { TextAttributes } from "@opentui/core";
import { useDialog } from "../../providers/dialog";
import { useToast } from "../../providers/toast";
import { usePromptConfig } from "../../providers/prompt-config";
import { apiClient } from "../../lib/api-client";
import { getErrorMessage } from "../../lib/http-errors";
import {
  PROVIDERS,
  type ProviderDefinition,
  DEFAULT_CHAT_MODEL_ID,
} from "@ANCIENT/shared";
import { DialogSearchList } from "../dialog-search-list";

type Connection = {
  id: string;
  label: string;
  protocol: string;
  modelId: string;
  keyLastFour: string;
  isValid: boolean;
  lastValidationError: string | null;
};

type ViewState = "list" | "form";

export const ModelsDialogContent = () => {
  const dialog = useDialog();
  const toast = useToast();
  const { setModelSelection } = usePromptConfig();

  const [view, setView] = useState<ViewState>("list");
  const [selectedProvider, setSelectedProvider] = useState<ProviderDefinition | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [modelSearch, setModelSearch] = useState("");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Fetch existing connections
  useEffect(() => {
    let ignore = false;
    const fetchConnections = async () => {
      try {
        const res = await apiClient["provider-connections"].$get();
        if (!res.ok) throw new Error(await getErrorMessage(res));
        const data = await res.json();
        if (!ignore) setConnections(data);
      } catch (error) {
        if (!ignore) {
          toast.show({
            variant: "error",
            message: error instanceof Error ? error.message : "Failed to fetch connections",
          });
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    };
    fetchConnections();
    return () => { ignore = true; };
  }, []);

  // ----- List view items -----
  // Single built-in item
  const builtinItem = {
    kind: "builtin" as const,
    id: "ancient",
    label: "ANCIENT (built-in)",
    provider: "built-in",
  };

  const customItems = connections.map((c) => ({
    kind: "custom" as const,
    id: c.id,
    label: c.label,
    protocol: c.protocol,
    modelId: c.modelId,
    isValid: c.isValid,
  }));

  const providerItems = PROVIDERS.map((p) => ({
    kind: "provider" as const,
    id: p.id,
    label: p.label,
    description: p.description,
    provider: p,
  }));

  const listItems = [builtinItem, ...customItems, ...providerItems];

  // ----- Handlers -----
  const handleSelectBuiltin = () => {
    // Select the default model ID (built-in)
    setModelSelection({
      modelKind: "builtin",
      modelId: DEFAULT_CHAT_MODEL_ID,
    });
    dialog.close();
  };

  const handleSelectCustom = (connectionId: string) => {
    setModelSelection({ modelKind: "custom", connectionId });
    dialog.close();
  };

  const handleSelectProvider = (provider: ProviderDefinition) => {
    setSelectedProvider(provider);
    setModelSearch(provider.defaultModelId || "");
    setSelectedModelId(provider.defaultModelId || "");
    setBaseUrl(provider.defaultBaseUrl || "");
    setApiKey("");
    setView("form");
  };

  const handleAddProvider = async () => {
    if (!selectedProvider) return;
    if (!selectedModelId.trim()) {
      toast.show({ variant: "error", message: "Please enter or select a model ID" });
      return;
    }
    if (!baseUrl.trim()) {
      toast.show({ variant: "error", message: "Please enter the API base URL" });
      return;
    }

    const isLocal = selectedProvider.id === "ollama" ||
      selectedProvider.id === "lmstudio" ||
      selectedProvider.id === "vllm";
    if (!apiKey && !isLocal) {
      toast.show({ variant: "error", message: `API key is required for ${selectedProvider.label}` });
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiClient["provider-connections"].$post({
        json: {
          label: `${selectedProvider.label} (${selectedModelId})`,
          protocol: selectedProvider.protocol,
          baseUrl: baseUrl.trim(),
          modelId: selectedModelId,
          apiKey,
        },
      });

      if (!res.ok) {
        const error = await getErrorMessage(res);
        throw new Error(error);
      }

      const connection = await res.json() as { id: string };
      setModelSelection({ modelKind: "custom", connectionId: connection.id });

      // Refresh connections
      const refreshRes = await apiClient["provider-connections"].$get();
      if (refreshRes.ok) {
        const data = await refreshRes.json();
        setConnections(data);
      }

      toast.show({ variant: "success", message: `${selectedProvider.label} connection added` });
      dialog.close();
    } catch (error) {
      toast.show({
        variant: "error",
        message: error instanceof Error ? error.message : "Failed to add connection",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelForm = () => {
    setView("list");
    setSelectedProvider(null);
    setModelSearch("");
    setSelectedModelId("");
    setBaseUrl("");
    setApiKey("");
  };

  // ----- Render helpers -----
  const renderListItem = (item: any, isSelected: boolean) => {
    if (item.kind === "builtin") {
      return (
        <box
          flexDirection="row"
          flexGrow={1}
          overflow="hidden"
          width="100%"
          onMouseDown={handleSelectBuiltin}
        >
          <text selectable={false} fg={isSelected ? "black" : "white"}>
            {item.label}
          </text>
          <box flexGrow={1} />
          <text
            selectable={false}
            attributes={TextAttributes.DIM}
            fg={isSelected ? "black" : undefined}
          >
            built‑in · free
          </text>
        </box>
      );
    }

    if (item.kind === "custom") {
      return (
        <box
          flexDirection="row"
          flexGrow={1}
          overflow="hidden"
          width="100%"
          onMouseDown={() => handleSelectCustom(item.id)}
        >
          <text selectable={false} fg={isSelected ? "black" : "white"}>
            {item.label}
          </text>
          <box flexGrow={1} />
          <text
            selectable={false}
            attributes={TextAttributes.DIM}
            fg={isSelected ? "black" : undefined}
          >
            {item.isValid ? "ready" : "needs attention"} · {item.protocol} · {item.modelId}
          </text>
        </box>
      );
    }

    if (item.kind === "provider") {
      const provider = item.provider;
      return (
        <box
          flexDirection="row"
          flexGrow={1}
          overflow="hidden"
          width="100%"
          onMouseDown={() => handleSelectProvider(provider)}
        >
          <text selectable={false} fg={isSelected ? "black" : "white"}>
            {item.label}
          </text>
          <box flexGrow={1} />
          <text
            selectable={false}
            attributes={TextAttributes.DIM}
            fg={isSelected ? "black" : undefined}
          >
            {item.description}
          </text>
        </box>
      );
    }

    return null;
  };

  const filterFn = (item: any, query: string) => {
    const search = query.toLowerCase();
    if (item.kind === "builtin") {
      return item.label.toLowerCase().includes(search) || item.provider.toLowerCase().includes(search);
    }
    if (item.kind === "custom") {
      return (
        item.label.toLowerCase().includes(search) ||
        item.protocol.toLowerCase().includes(search) ||
        item.modelId.toLowerCase().includes(search)
      );
    }
    if (item.kind === "provider") {
      return (
        item.label.toLowerCase().includes(search) ||
        item.description.toLowerCase().includes(search) ||
        item.id.toLowerCase().includes(search) ||
        item.provider.models.some((m: any) => m.id.toLowerCase().includes(search))
      );
    }
    return false;
  };

  // ----- Render -----
  if (loading) {
    return (
      <box flexDirection="column">
        <text attributes={TextAttributes.DIM}>Loading models...</text>
      </box>
    );
  }

  // Form view
  if (view === "form" && selectedProvider) {
    const provider = selectedProvider;
    const isLocal = provider.id === "ollama" || provider.id === "lmstudio" || provider.id === "vllm";

    // Filter models for suggestions
    const filteredModels = provider.models.filter((m) =>
      m.id.toLowerCase().includes(modelSearch.toLowerCase()) ||
      m.label.toLowerCase().includes(modelSearch.toLowerCase())
    );

    return (
      <box flexDirection="column" gap={2}>
        <box flexDirection="column" gap={0.5}>
          <text attributes={TextAttributes.BOLD}>{provider.label}</text>
          <text attributes={TextAttributes.DIM}>{provider.description}</text>
        </box>

        {/* Model search */}
        <box flexDirection="column">
          <text attributes={TextAttributes.DIM}>Model ID</text>
          <input
            placeholder={`e.g. ${provider.defaultModelId || "gpt-4o-mini"}`}
            value={modelSearch}
            onInput={(value) => {
              setModelSearch(value);
              setSelectedModelId(value);
            }}
          />
          {modelSearch && filteredModels.length > 0 && (
            <box flexDirection="column" maxHeight={4} overflow="hidden" paddingTop={0.5}>
              {filteredModels.slice(0, 5).map((m) => (
                <text
                  key={m.id}
                  attributes={TextAttributes.DIM}
                  onMouseDown={() => {
                    setModelSearch(m.id);
                    setSelectedModelId(m.id);
                  }}
                >
                  {m.label} ({m.id})
                </text>
              ))}
            </box>
          )}
        </box>

        {/* Base URL */}
        <box flexDirection="column">
          <text attributes={TextAttributes.DIM}>Base URL</text>
          <input
            placeholder={provider.defaultBaseUrl || "https://api.example.com/v1"}
            value={baseUrl}
            onInput={(value) => setBaseUrl(value)}
          />
        </box>

        {/* API Key */}
        <box flexDirection="column">
          <text attributes={TextAttributes.DIM}>API Key</text>
          <input
            placeholder={isLocal ? "Optional for local servers" : "sk-... (required)"}
            type="password"
            value={apiKey}
            onInput={(value) => setApiKey(value)}
          />
          <text attributes={TextAttributes.DIM} fontSize={0.8}>
            {isLocal
              ? "Leave blank if your local server doesn't require authentication."
              : "Your API key is encrypted before storage."}
          </text>
        </box>

        {/* Actions */}
        <box flexDirection="row" justifyContent="flex-end" gap={2} paddingTop={1}>
          <text attributes={TextAttributes.DIM} onMouseDown={handleCancelForm}>
            Cancel
          </text>
          <text
            attributes={submitting ? TextAttributes.DIM : undefined}
            onMouseDown={handleAddProvider}
          >
            {submitting ? "Adding..." : "Add Connection"}
          </text>
        </box>
      </box>
    );
  }

  // List view
  return (
    <box flexDirection="column" gap={1}>
      <DialogSearchList
        items={listItems}
        onSelect={() => { }}
        filterFn={filterFn}
        renderItem={renderListItem}
        getKey={(item) => `${item.kind}-${item.id}`}
        placeholder="Search models, providers, or connections..."
        emptyText="No matching items"
      />
      {connections.length > 0 && (
        <box flexDirection="row" justifyContent="flex-start" paddingTop={1}>
          <text attributes={TextAttributes.DIM}>
            {connections.length} custom connection{connections.length !== 1 ? "s" : ""} saved
          </text>
        </box>
      )}
    </box>
  );
};