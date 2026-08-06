// use-chat.ts
import { useMemo } from "react";
import { useChat as useAiChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  type InferUITools,
  lastAssistantMessageIsCompleteWithToolCalls,
  type LanguageModelUsage,
  type UIDataTypes,
  type UIMessage,
} from "ai";
import {
  type ModeType,
  type ChatModelSelection,
  type ToolContracts,
} from "@ANCIENT/shared";
import { API_URL, apiClient } from "../lib/api-client";
import { getAuth } from "../lib/auth";
import { executeLocalTool } from "../lib/local-tools";

export type ChatMessageMetadata = {
  mode?: ModeType;
  model?: ChatModelSelection;
  durationMs?: number;
  usage?: LanguageModelUsage;
};

type ChatTools = {
  [Name in keyof InferUITools<ToolContracts>]: {
    input: InferUITools<ToolContracts>[Name]["input"];
    output: unknown;
  };
};

export type Message = UIMessage<ChatMessageMetadata, any, ChatTools>;

export function useChat(sessionId: string, initialMessages: Message[]) {
  const transport = useMemo(() => {
    const chatUrl = `${API_URL}/chat/${sessionId}`;
    return new DefaultChatTransport<Message>({
      api: chatUrl,
      headers(): Record<string, string> {
        const auth = getAuth();
        const headers: Record<string, string> = {};
        if (auth) headers.Authorization = `Bearer ${auth.token}`;
        return headers;
      },
      prepareSendMessagesRequest({ messages }) {
        const userMessages = messages.filter((m) => m.role === "user");
        if (userMessages.length === 0) {
          throw new Error("No user message to send");
        }
        const lastUser = userMessages[userMessages.length - 1]!;
        const content = lastUser.parts
          .filter((part): part is Extract<(typeof lastUser.parts)[number], { type: "text" }> => part.type === "text")
          .map((part) => part.text)
          .join("");
        const metadata = messages.findLast(
          (m) => m.metadata?.mode && m.metadata?.model,
        )?.metadata;
        return {
          body: {
            content,
            mode: lastUser.metadata?.mode ?? metadata?.mode,
            model: lastUser.metadata?.model ?? metadata?.model,
          },
        };
      },
    });
  }, [sessionId]);

  const chat = useAiChat<Message>({
    id: sessionId,
    messages: initialMessages,
    transport,
    onToolCall({ toolCall }) {
      const mode = chat.messages.at(-1)?.metadata?.mode ?? "BUILD";

      // Some toolCall shapes don't expose a `tool` property on the typed
      // interface. Use a safe any-cast to read common fields (tool, name,
      // toolName) so TypeScript won't error here while preserving runtime
      // behavior.
      const toolIdentifier = (toolCall as any).tool ?? (toolCall as any).name ?? (toolCall as any).toolName;

      void executeLocalTool(toolIdentifier, toolCall.input as Record<string, unknown>, mode)
        .then((output) =>
          chat.addToolResult({
            toolCallId: toolCall.toolCallId,
            tool: toolIdentifier,
            output: output as unknown,
          }),
        )
        .catch((error) =>
          chat.addToolResult({
            toolCallId: toolCall.toolCallId,
            tool: toolIdentifier,
            output: `Error: ${error instanceof Error ? error.message : String(error)}` as unknown,
          }),
        );
    },
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
  });

  return {
    messages: chat.messages,
    status: chat.status,
    error: chat.error,
    submit: (params: {
      userText: string;
      mode: ModeType;
      modelSelection: ChatModelSelection;
    }) => {
      return chat.sendMessage({
        text: params.userText,
        metadata: {
          mode: params.mode,
          model: params.modelSelection,
        },
      });
    },
    abort: chat.stop,
    interrupt: chat.stop,
  };
}