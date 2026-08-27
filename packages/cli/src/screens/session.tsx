// session.tsx
import { useState, useEffect, useMemo, useRef } from "react";
import { useParams, useLocation, useNavigate } from "react-router";
import { z } from "zod";
import { useKeyboard } from "@opentui/react";
import {
    type ModeType,
    type ChatModelSelection,
    chatModelSelectionSchema,
} from "@ANCIENT/shared";
import { SessionShell } from "../components/session-shell";
import { UserMessage, BotMessage, ErrorMessage } from "../components/messages";
import { useToast } from "../providers/toast";
import { useChat } from "../hooks/use-chat";
import { usePromptConfig } from "../providers/prompt-config";
import type { Message } from "../hooks/use-chat";
import { apiClient } from "../lib/api-client";
import { getErrorMessage } from "../lib/http-errors";
import { useKeyboardLayer } from "../providers/Keyboard-layer";
import { copyToClipboard } from "../lib/clipboard";
import {
  openLearningStore,
  saveObservations,
  defaultLearningFile,
  LearningStore,
  cliLatency,
} from "../lib/experience";

function messageText(msg: Message): string {
    const parts = Array.isArray(msg.parts) ? msg.parts : [];
    const partText = parts
        .filter((p) => p.type === "text")
        .map((p) => (p as { text?: string }).text ?? "")
        .join("");
    if (partText) return partText;
    return (msg as unknown as { content?: string }).content ?? "";
}

function extractErrorCode(message: string): string | null {
    const match = message.match(/([A-Z][A-Z0-9]{1,9}\d{2,4})/);
    return match ? match[1]! : null;
}

function makeRecorder(cwd: string) {
    const file = defaultLearningFile(cwd);
    // Synchronous best-effort open; persistence happens on meaningful events.
    const learning = new LearningStore();
    void openLearningStore(file).then((store) => {
        learning.recordMany(store.all);
    });
    return { learning, file };
}

type SessionData = {
    id: string;
    title: string;
    createdAt: string;
    messages: Array<{
        id: string;
        role: "USER" | "ASSISTANT" | "ERROR";
        content: string;
        status: string;
        createdAt: string;
        parts?: unknown;
    }>;
};

const sessionLocationSchema = z.object({
    session: z.custom<SessionData>((val) => val != null && typeof val === "object" && "id" in val),
    initialPrompt: z
        .object({
            message: z.string(),
            mode: z.custom<ModeType>(),
            model: chatModelSelectionSchema,
        })
        .optional(),
});

function ChatMessage({ msg }: { msg: Message }) {
    const role = String(msg.role).toLowerCase();
    const parts = Array.isArray(msg.parts) ? msg.parts : [];
    const rawContent = (msg as unknown as { content?: string }).content ?? "";

    if (role === "user") {
        const text = parts.length
            ? parts.filter((p) => p.type === "text").map((p) => p.text).join("")
            : rawContent;
        return <UserMessage message={text} mode={msg.metadata?.mode ?? "BUILD"} />;
    }

    if (role === "error") {
        const text = parts.length
            ? parts.filter((p) => p.type === "text").map((p) => p.text).join("")
            : rawContent;
        return <ErrorMessage message={text} />;
    }

    return (
        <BotMessage
            parts={parts}
            model={msg.metadata?.model?.modelKind === "builtin" ? msg.metadata.model.modelId : "custom"}
            mode={msg.metadata?.mode ?? "BUILD"}
            durationMs={msg.metadata?.durationMs}
            streaming={false}
        />
    );
}

function SessionChat({
    session,
    initialPrompt,
}: {
    session: SessionData;
    initialPrompt?: { message: string; mode: ModeType; model: ChatModelSelection };
}) {
    const [initialMessages] = useState(() => session.messages as unknown as Message[]);
    const { mode, modelSelection } = usePromptConfig();
    const { isTopLayer } = useKeyboardLayer();
    const toast = useToast();
    const { messages, status, submit, abort, interrupt, error } = useChat(
        session.id,
        initialMessages
    );
    const hasSubmittedInitialPromptRef = useRef(false);
    const [prefill, setPrefill] = useState<{ text: string; nonce: number } | null>(null);

    useEffect(() => {
        return () => void abort();
    }, [abort]);

    useKeyboard((key) => {
        if (key.name === "escape" && isTopLayer("base") && status === "streaming") {
            key.preventDefault();
            interrupt();
        }
    });

    useKeyboard((key) => {
        if (!isTopLayer("base")) return;
        if (key.name !== "y" && key.name !== "r") return;

        if (key.name === "y") {
            const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
            if (!lastAssistant) {
                toast.show({ variant: "info", message: "No assistant output to copy yet" });
                return;
            }
            const text = messageText(lastAssistant);
            key.preventDefault();
            void copyToClipboard(text).then((ok) => {
                toast.show({
                    variant: ok ? "success" : "error",
                    message: ok
                        ? "Copied last assistant output to clipboard"
                        : "Clipboard unavailable on this platform",
                });
            });
            return;
        }

        if (key.name === "r") {
            const lastUser = [...messages].reverse().find((m) => m.role === "user");
            if (!lastUser) {
                toast.show({ variant: "info", message: "No prompt to re-send yet" });
                return;
            }
            key.preventDefault();
            setPrefill((prev) => ({
                text: messageText(lastUser),
                nonce: (prev?.nonce ?? 0) + 1,
            }));
            return;
        }
    });

    useEffect(() => {
        if (!initialPrompt || hasSubmittedInitialPromptRef.current) return;
        hasSubmittedInitialPromptRef.current = true;
        void submit({
            userText: initialPrompt.message,
            mode: initialPrompt.mode,
            modelSelection: initialPrompt.model,
        });
    }, [initialPrompt, submit]);

    // Learning: record preference and error-pattern observations.
    const recorderRef = useRef<ReturnType<typeof makeRecorder> | null>(null);
    if (!recorderRef.current) {
        recorderRef.current = makeRecorder(process.cwd());
    }
    const recorder = recorderRef.current;

    useEffect(() => {
        recorder.learning.record({ kind: "mode", value: mode, at: Date.now() });
        recorder.learning.record({
            kind: "model",
            value: modelSelection.modelKind === "builtin" ? modelSelection.modelId : "custom",
            at: Date.now(),
        });
    }, [recorder, mode, modelSelection]);

    useEffect(() => {
        if (!error) return;
        const code = extractErrorCode(error.message);
        if (code) {
            recorder.learning.record({ kind: "error", code, at: Date.now() });
            void saveObservations(recorder.file, recorder.learning.all);
        }
    }, [recorder, error]);

    // Performance: record server round-trip latency when a submit leaves the
    // streaming/submitted state (i.e. a chat request completed).
    const runStartRef = useRef<number | null>(null);
    const wasRunningRef = useRef(false);
    useEffect(() => {
        const isRunning = status === "submitted" || status === "streaming";
        if (isRunning && !wasRunningRef.current) {
            runStartRef.current = performance.now();
        } else if (!isRunning && wasRunningRef.current && runStartRef.current != null) {
            cliLatency.record("server", performance.now() - runStartRef.current);
            runStartRef.current = null;
        }
        wasRunningRef.current = isRunning;
    }, [status]);

    return (
        <SessionShell
            onSubmit={(text) => submit({ userText: text, mode, modelSelection })}
            loading={status === "submitted" || status === "streaming"}
            interruptible={status === "submitted" || status === "streaming"}
            prefill={prefill}
        >
            {messages.map((msg) => (
                <ChatMessage key={msg.id} msg={msg} />
            ))}
            {error && <ErrorMessage message={error.message} />}
        </SessionShell>
    );
}

export function Session() {
    const { id } = useParams();
    const location = useLocation();
    const navigate = useNavigate();
    const toast = useToast();

    const prefetched = useMemo(() => {
        const parsed = sessionLocationSchema.safeParse(location.state);
        return parsed.success ? parsed.data : null;
    }, [location.state]);

    const [session, setSession] = useState<SessionData | null>(prefetched?.session ?? null);

    useEffect(() => {
        if (prefetched?.session) return;

        setSession(null);
        if (!id) return;

        let ignore = false;
        const fetchSession = async () => {
            try {
                const resolved = await apiClient.sessions.get(id);
                if (ignore) return;
                setSession(resolved);
            } catch (err) {
                if (ignore) return;
                toast.show({
                    variant: "error",
                    message: err instanceof Error ? err.message : "Failed to load session",
                });
                navigate("/", { replace: true });
            }
        };

        fetchSession();
        return () => {
            ignore = true;
        };
    }, [id, prefetched, toast, navigate]);

    if (!session) {
        return <SessionShell onSubmit={() => { }} inputDisabled loading />;
    }

    return <SessionChat key={session.id} session={session} initialPrompt={prefetched?.initialPrompt} />;
}