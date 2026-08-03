// use-chat.ts
import { useMemo } from "react";
import { useChat as useAiChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  type InferUITools,
  lastAssistantMessageIsCompleteWithToolCalls,
  type LanguageModelUsage,
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

export type Message = UIMessage<ChatMessageMetadata, never, ChatTools>;

export function useChat(sessionId: string, initialMessages: Message[]) {
  const transport = useMemo(() => {
    const chatUrl = `${API_URL}/chat/${sessionId}`;
    return new DefaultChatTransport<Message>({
      api: chatUrl,
      // FIXED: the ternary's two branches inferred incompatible object
      // shapes ({ Authorization: string } vs {}), which doesn't satisfy
      // Record<string, string>. Build the object imperatively instead.
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
        // FIXED: UIMessage in ai@6 has no `.content` string — text lives in
        // `.parts` (same parts-array shape the server already uses in
        // chat.ts). `.content` was silently `undefined` here before.
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

      void executeLocalTool(toolCall.toolName, toolCall.input, mode)
        .then((output) =>
          chat.addToolOutput({
            tool: toolCall.toolName as keyof ChatTools,
            toolCallId: toolCall.toolCallId,
            output,
          }),
        )
        .catch((error) =>
          chat.addToolOutput({
            tool: toolCall.toolName as keyof ChatTools,
            toolCallId: toolCall.toolCallId,
            state: "output-error",
            errorText: error instanceof Error ? error.message : String(error),
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