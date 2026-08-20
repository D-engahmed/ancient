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
  baseUrl: string;
  modelId: string;
  keyLastFour: string;
  isValid: boolean;
  lastValidationError: string | null;
};

type ViewState = "list" | "form";
type FormMode = "add" | "edit";

export const ModelsDialogContent = () => {
  const dialog = useDialog();
  const toast = useToast();
  const { modelSelection, setModelSelection } = usePromptConfig();
  const { isTopLayer } = useKeyboardLayer();
  const { colors } = useTheme();

  const [view, setView] = useState<ViewState>("list");
  const [formMode, setFormMode] = useState<FormMode>("add");
  const [editingConnection, setEditingConnection] = useState<Connection | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<ProviderDefinition | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [modelSearch, setModelSearch] = useState("");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [modelSuggestIndex, setModelSuggestIndex] = useState(0);
  // id of the custom row currently showing "delete this? yes / no" in place
  // of its usual status text. Cleared on cancel, confirm, or re-highlight.
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
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
    baseUrl: c.baseUrl,
    modelId: c.modelId,
    isValid: c.isValid,
    keyLastFour: c.keyLastFour,
    lastValidationError: c.lastValidationError,
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
    setFormMode("add");
    setEditingConnection(null);
    setSelectedProvider(provider);
    // Leave the search box empty so the full model list shows in the
    // suggestion dropdown (placeholder shows the default as a hint).
    // selectedModelId still carries the default so "Add" works even if
    // the user never touches the field.
    setModelSearch("");
    setSelectedModelId(provider.defaultModelId || "");
    setBaseUrl(provider.defaultBaseUrl || "");
    setApiKey("");
    setModelSuggestIndex(0);
    setView("form");
  };

  // Opens the same form used for "add", pre-filled from the connection.
  // NOTE: a saved connection has no link back to which PROVIDERS[] catalog
  // entry it was created from (protocol alone is ambiguous — several
  // providers share e.g. "openai" as their protocol), so this intentionally
  // does NOT try to reconstruct selectedProvider. Edit mode shows the raw
  // Model ID / Base URL / API key fields with no provider header or model
  // suggestion list. Full parity with "add" would need a providerId column
  // on ProviderConnection — flagging that as separate scope, not faking it
  // with a best-effort baseUrl match that'll be wrong for reseller/BYOK
  // endpoints like OpenRouter.
  const handleEditConnection = (connection: Connection) => {
    setDeleteConfirmId(null);
    setFormMode("edit");
    setEditingConnection(connection);
    setSelectedProvider(null);
    setModelSearch(connection.modelId);
    setSelectedModelId(connection.modelId);
    setBaseUrl(connection.baseUrl);
    setApiKey("");
    setModelSuggestIndex(0);
    setView("form");
  };

  const handleSaveEdit = async () => {
    if (!editingConnection) return;
    if (!selectedModelId.trim()) {
      toast.show({ variant: "error", message: "Please enter a model ID" });
      return;
    }
    if (!baseUrl.trim()) {
      toast.show({ variant: "error", message: "Please enter the API base URL" });
      return;
    }

    setSubmitting(true);
    try {
      const payload: Record<string, string> = {
        modelId: selectedModelId,
        baseUrl: baseUrl.trim(),
      };
      // Blank means "keep the current key" — the server already treats a
      // missing apiKey field this way (updateConnectionSchema.apiKey is
      // optional), so an empty field here must be omitted, not sent as "".
      if (apiKey.trim()) payload.apiKey = apiKey;

      const updated = await apiClient.providerConnections.update(
        editingConnection.id,
        payload
      ) as Connection;

      setConnections((prev) =>
        prev.map((c) => (c.id === updated.id ? updated : c))
      );
      toast.show({ variant: "success", message: "Connection updated" });
      handleCancelForm();
    } catch (error) {
      toast.show({
        variant: "error",
        message: error instanceof Error ? error.message : "Failed to update connection",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestDelete = (id: string) => setDeleteConfirmId(id);
  const handleCancelDelete = () => setDeleteConfirmId(null);

  const handleConfirmDelete = async (id: string) => {
    setDeleting(true);
    try {
      await apiClient.providerConnections.delete(id);
      setConnections((prev) => prev.filter((c) => c.id !== id));

      // Deleting the connection you're currently talking through: fall back
      // to the built-in model with no toast, per explicit product decision —
      // the status bar already reflects the switch, so this isn't silent in
      // the sense of "undetectable," just not interrupted with a banner.
      if (modelSelection.modelKind === "custom" && modelSelection.connectionId === id) {
        setModelSelection({ modelKind: "builtin", modelId: DEFAULT_CHAT_MODEL_ID });
      } else {
        toast.show({ variant: "success", message: "Connection deleted" });
      }
    } catch (error) {
      toast.show({
        variant: "error",
        message: error instanceof Error ? error.message : "Failed to delete connection",
      });
    } finally {
      setDeleting(false);
      setDeleteConfirmId(null);
    }
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
    setFormMode("add");
    setEditingConnection(null);
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
      const confirmingDelete = deleteConfirmId === item.id;

      return (
        <box
          flexDirection="row"
          flexGrow={1}
          overflow="hidden"
          width="100%"
          onMouseDown={() => {
            if (confirmingDelete) return; // row clicks shouldn't select while confirming
            handleSelectCustom(item.id);
          }}
        >
          <box flexShrink={0} overflow="hidden">
            <text selectable={false} fg={isSelected ? "black" : "white"}>
              {item.label}
            </text>
          </box>
          <box flexGrow={1} />
          {confirmingDelete ? (
            <box flexDirection="row" flexShrink={0}>
              <text
                selectable={false}
                fg={isSelected ? "black" : "white"}
                onMouseDown={(e: any) => {
                  e.stopPropagation();
                  handleConfirmDelete(item.id);
                }}
              >
                {deleting ? "Deleting..." : "Confirm delete"}
              </text>
              <text selectable={false} fg={isSelected ? "black" : undefined} attributes={TextAttributes.DIM}>
                {"  ·  "}
              </text>
              <text
                selectable={false}
                fg={isSelected ? "black" : "white"}
                onMouseDown={(e: any) => {
                  e.stopPropagation();
                  handleCancelDelete();
                }}
              >
                Cancel
              </text>
            </box>
          ) : isSelected ? (
            <box flexDirection="row" flexShrink={0}>
              <text
                selectable={false}
                fg="black"
                onMouseDown={(e: any) => {
                  e.stopPropagation();
                  handleEditConnection(item as unknown as Connection);
                }}
              >
                Edit
              </text>
              <text selectable={false} fg="black" attributes={TextAttributes.DIM}>
                {"  ·  "}
              </text>
              <text
                selectable={false}
                fg="black"
                onMouseDown={(e: any) => {
                  e.stopPropagation();
                  handleRequestDelete(item.id);
                }}
              >
                Delete
              </text>
              <text selectable={false} fg="black" attributes={TextAttributes.DIM}>
                {"  ·  "}
              </text>
              <text selectable={false} fg="black" attributes={TextAttributes.DIM}>
                {item.isValid ? "ready" : "needs attention"} · {item.protocol} · {item.modelId}
              </text>
            </box>
          ) : (
            <text
              selectable={false}
              attributes={TextAttributes.DIM}
            >
              {item.isValid ? "ready" : "needs attention"} · {item.protocol} · {item.modelId}
            </text>
          )}
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

  if (view === "form" && (selectedProvider || formMode === "edit")) {
    const provider = selectedProvider; // null in edit mode — see handleEditConnection
    const isEdit = formMode === "edit";
    const isLocal = provider ? (provider.id === "ollama" || provider.id === "lmstudio" || provider.id === "vllm") : false;

    return (
      <box flexDirection="column" gap={2}>
        <box flexDirection="column" gap={0.5}>
          <text attributes={TextAttributes.BOLD}>
            {isEdit ? editingConnection?.label ?? "Edit connection" : provider!.label}
          </text>
          <text attributes={TextAttributes.DIM}>
            {isEdit ? "Editing an existing connection" : provider!.description}
          </text>
        </box>

        <box flexDirection="column">
          <text attributes={TextAttributes.DIM}>Model ID</text>
          <input
            placeholder={isEdit ? "Model ID" : `e.g. ${provider!.defaultModelId || "gpt-4o-mini"}`}
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
            placeholder={provider?.defaultBaseUrl || "https://api.example.com/v1"}
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
            placeholder={
              isEdit
                ? `Leave blank to keep current key (••••${editingConnection?.keyLastFour ?? "????"})`
                : isLocal
                ? "Optional for local servers"
                : "sk-... (required)"
            }
            value={apiKey}
            onInput={(value) => setApiKey(value)}
          />
          <text attributes={TextAttributes.DIM}>
            {isEdit
              ? "Only sent if you type a new key — the stored key is otherwise left untouched."
              : isLocal
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
            onMouseDown={isEdit ? handleSaveEdit : handleAddProvider}
          >
            {isEdit
              ? submitting ? "Saving..." : "Save changes"
              : submitting ? "Adding..." : "Add Connection"}
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
        onHighlight={(item: any) => {
          // Don't let a stale "delete this?" prompt linger on a row the
          // user has since navigated away from.
          if (deleteConfirmId && item.id !== deleteConfirmId) setDeleteConfirmId(null);
        }}
        filterFn={filterFn}
        renderItem={renderListItem}
        getKey={(item) => `${item.kind}-${item.id}`}
        placeholder="Search models, providers, or connections..."
        emptyText="No matching items"
      />
      {connections.length > 0 && (
        <box flexDirection="row" justifyContent="flex-start" paddingTop={1}>
          <text attributes={TextAttributes.DIM}>
            {connections.length} custom connection{connections.length !== 1 ? "s" : ""} saved · highlight one for edit/delete
          </text>
        </box>
      )}
    </box>
  );
};