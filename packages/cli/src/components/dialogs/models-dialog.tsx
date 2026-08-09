// packages/cli/src/components/dialogs/models-dialog.tsx
import { useCallback, useEffect, useState, useMemo, useRef } from "react";
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useDialog } from "../../providers/dialog";
import { useToast } from "../../providers/toast";
import { usePromptConfig } from "../../providers/prompt-config";
import { useKeyboardLayer } from "../../providers/Keyboard-layer";
import { useTheme } from "../../providers/theme";
import { apiClient } from "../../lib/api-client";
import {
  PROVIDERS,
  type ProviderDefinition,
  type ProviderModel,
  DEFAULT_CHAT_MODEL_ID,
} from "@ANCIENT/shared";
import { DialogSearchList } from "../dialog-search-list";

const MAX_VISIBLE_MODEL_SUGGESTIONS = 5;

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
  const { isTopLayer } = useKeyboardLayer();
  const { colors } = useTheme();

  const [view, setView] = useState<ViewState>("list");
  const [selectedProvider, setSelectedProvider] = useState<ProviderDefinition | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [modelSearch, setModelSearch] = useState("");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [modelSuggestIndex, setModelSuggestIndex] = useState(0);
  const modelScrollRef = useRef<ScrollBoxRenderable>(null);

  // Fetch existing connections
  useEffect(() => {
    let ignore = false;
    const fetchConnections = async () => {
      try {
        // FIXED: apiClient has no "provider-connections"/$get RPC shape — it's
        // the plain REST wrapper from lib/api-client.ts, which already parses
        // JSON and throws on a non-2xx response.
        const data = await apiClient.providerConnections.list();
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
    setModelSuggestIndex(0);
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
      // FIXED: was apiClient["provider-connections"].$post({ json: {...} }) —
      // that RPC shape doesn't exist anywhere on this client.
      const connection = await apiClient.providerConnections.create({
        label: `${selectedProvider.label} (${selectedModelId})`,
        protocol: selectedProvider.protocol,
        baseUrl: baseUrl.trim(),
        modelId: selectedModelId,
        apiKey,
      }) as { id: string };

      setModelSelection({ modelKind: "custom", connectionId: connection.id });

      const data = await apiClient.providerConnections.list();
      setConnections(data);

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
    setModelSuggestIndex(0);
  };

  // ----- Model ID suggestions (form view) -----
  const filteredModels = useMemo(() => {
    if (!selectedProvider) return [];
    const query = modelSearch.toLowerCase();
    return selectedProvider.models.filter(
      (m) => m.id.toLowerCase().includes(query) || m.label.toLowerCase().includes(query)
    );
  }, [selectedProvider, modelSearch]);

  const selectModelSuggestion = useCallback((model: ProviderModel) => {
    setModelSearch(model.id);
    setSelectedModelId(model.id);
    setModelSuggestIndex(0);
  }, []);

  // Down arrow steps through the matching models for the current provider;
  // Enter fills the Model ID field with whichever one is highlighted.
  useKeyboard((key) => {
    if (view !== "form" || !isTopLayer("dialog")) return;
    if (filteredModels.length === 0) return;

    if (key.name === "down") {
      key.preventDefault();
      setModelSuggestIndex((i) => {
        const nextIndex = Math.min(filteredModels.length - 1, i + 1);
        const sb = modelScrollRef.current;
        if (sb) {
          const viewportHeight = sb.viewport.height;
          const visibleEnd = sb.scrollTop + viewportHeight - 1;
          if (nextIndex > visibleEnd) {
            sb.scrollTo(nextIndex - viewportHeight + 1);
          }
        }
        return nextIndex;
      });
    } else if (key.name === "up") {
      key.preventDefault();
      setModelSuggestIndex((i) => {
        const nextIndex = Math.max(0, i - 1);
        const sb = modelScrollRef.current;
        if (sb && nextIndex < sb.scrollTop) {
          sb.scrollTo(nextIndex);
        }
        return nextIndex;
      });
    } else if (key.name === "return" || key.name === "enter") {
      const model = filteredModels[modelSuggestIndex];
      if (model) {
        key.preventDefault();
        selectModelSuggestion(model);
      }
    }
  });

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

  if (loading) {
    return (
      <box flexDirection="column">
        <text attributes={TextAttributes.DIM}>Loading models...</text>
      </box>
    );
  }

  if (view === "form" && selectedProvider) {
    const provider = selectedProvider;
    const isLocal = provider.id === "ollama" || provider.id === "lmstudio" || provider.id === "vllm";

    return (
      <box flexDirection="column" gap={2}>
        <box flexDirection="column" gap={0.5}>
          <text attributes={TextAttributes.BOLD}>{provider.label}</text>
          <text attributes={TextAttributes.DIM}>{provider.description}</text>
        </box>

        <box flexDirection="column">
          <text attributes={TextAttributes.DIM}>Model ID</text>
          <input
            placeholder={`e.g. ${provider.defaultModelId || "gpt-4o-mini"}`}
            value={modelSearch}
            onInput={(value) => {
              setModelSearch(value);
              setSelectedModelId(value);
              setModelSuggestIndex(0);
            }}
          />
          {filteredModels.length > 0 && (
            <box flexDirection="column" paddingTop={0.5}>
              <scrollbox
                ref={modelScrollRef}
                height={Math.min(filteredModels.length, MAX_VISIBLE_MODEL_SUGGESTIONS)}
              >
                {filteredModels.map((m, index) => {
                  const isSelected = index === modelSuggestIndex;
                  return (
                    <box
                      key={m.id}
                      flexDirection="row"
                      height={1}
                      overflow="hidden"
                      backgroundColor={isSelected ? colors.selection : undefined}
                      onMouseMove={() => setModelSuggestIndex(index)}
                      onMouseDown={() => selectModelSuggestion(m)}
                    >
                      <box flexShrink={0} overflow="hidden">
                        <text selectable={false} fg={isSelected ? "black" : "white"}>
                          {m.label}
                        </text>
                      </box>
                      <box flexGrow={1} />
                      <box flexShrink={0} paddingLeft={1} overflow="hidden">
                        <text
                          selectable={false}
                          attributes={TextAttributes.DIM}
                          fg={isSelected ? "black" : undefined}
                        >
                          {m.id}
                        </text>
                      </box>
                    </box>
                  );
                })}
              </scrollbox>
              <text attributes={TextAttributes.DIM}>
                ↓/↑ to browse, enter to select
              </text>
            </box>
          )}
        </box>

        <box flexDirection="column">
          <text attributes={TextAttributes.DIM}>Base URL</text>
          <input
            placeholder={provider.defaultBaseUrl || "https://api.example.com/v1"}
            value={baseUrl}
            onInput={(value) => setBaseUrl(value)}
          />
        </box>

        <box flexDirection="column">
          <text attributes={TextAttributes.DIM}>API Key</text>
          {/* NOT FIXED — flagging instead of faking it: @opentui/core's
              InputRenderableOptions has no password/mask option at all
              (checked the actual .d.ts), so `type="password"` was a
              silent no-op — this field has always echoed the real key
              in plaintext as it's typed. Removing the invalid prop fixes
              the type error but does NOT restore masking; that needs a
              real design decision (custom masked renderable, paste-only
              entry, etc.), not a one-line patch. */}
          <input
            placeholder={isLocal ? "Optional for local servers" : "sk-... (required)"}
            value={apiKey}
            onInput={(value) => setApiKey(value)}
          />
          <text attributes={TextAttributes.DIM}>
            {isLocal
              ? "Leave blank if your local server doesn't require authentication."
              : "Your API key is encrypted before storage."}
          </text>
        </box>

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