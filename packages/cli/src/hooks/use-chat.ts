import { useCallback, useMemo } from "react";
import { useChat as useAiChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  type InferUITools,
  lastAssistantMessageIsCompleteWithToolCalls,
  type LanguageModelUsage,
  type UIMessage,
} from "ai";
import {
  type SupportedChatModelId,
  type ModeType,
  type ToolContracts,
} from "@maxintel/shared";
import { apiClient } from "../lib/api-client";
import { getAuth } from "../lib/auth";
import { executeLocalTool } from "../lib/local-tools";
import { openCheckoutForError } from "../lib/upgrade";

export type ChatMessageMetaData = {
  mode?: ModeType;
  model?: SupportedChatModelId | string;
  durationMs?: number;
  usage?: LanguageModelUsage;
};

type ChatTools = {
  [Name in keyof InferUITools<ToolContracts>]: {
    input: InferUITools<ToolContracts>[Name]["input"];
    output: unknown;
  };
};

export type Message = UIMessage<ChatMessageMetaData, never, ChatTools>;

export type SubmitParams = {
  userText: string;
  mode: ModeType;
  model: SupportedChatModelId;
};

export function useChat(sessionId: string, initialMessages: Message[]) {
  const transport = useMemo(() => {
    return new DefaultChatTransport<Message>({
      api: apiClient.chat.$url().toString(),
      headers(): Record<string, string> {
        const auth = getAuth();
        return auth ? { Authorization: `Bearer ${auth.token}` } : {};
      },
      prepareSendMessagesRequest({ messages }) {
        const message = messages[messages.length - 1];
        if (!message) throw new Error("No messages to send");
        // Only the trailing turn is sent; the server persists history by session
        // id. A tool-continuation send trails an assistant message, so the
        // preceding user message is included to keep the pair intact.
        const previousMessage = messages[messages.length - 2];
        const requestMessages =
          message.role === "assistant" && previousMessage?.role === "user"
            ? [previousMessage, message]
            : [message];
        // Falls back to the most recent turn that carried both, for sends that
        // originate from the SDK rather than from submit().
        const metadata =
          message.metadata?.mode && message.metadata?.model
            ? message.metadata
            : messages.findLast((m) => m.metadata?.mode && m.metadata?.model)
                ?.metadata;
        return {
          body: {
            id: sessionId,
            messages: requestMessages,
            mode: metadata?.mode,
            model: metadata?.model,
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
      // The server stamps mode onto the assistant message's metadata in the
      // stream's "start" part, so it is present by the time a tool call opens.
      // `chat` is read from the SDK's latest-callback ref, so this is current.
      const mode = chat.messages.at(-1)?.metadata?.mode ?? "BUILD";
      const tool = toolCall.toolName as keyof ChatTools;
      void executeLocalTool(toolCall.toolName, toolCall.input, mode)
        .then((output) =>
          chat.addToolOutput({
            tool,
            toolCallId: toolCall.toolCallId,
            output,
          }),
        )
        .catch((error: unknown) =>
          chat.addToolOutput({
            tool,
            toolCallId: toolCall.toolCallId,
            state: "output-error",
            errorText: error instanceof Error ? error.message : String(error),
          }),
        );
    },
    onError(error) {
      // A 402 is not really an error the user should have to decode — it means
      // "pay and carry on". Open the MoMo checkout straight away; the rendered
      // message (see formatChatError) carries the same link for terminals
      // where a browser cannot be launched.
      openCheckoutForError(error);
    },
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
  });

  const { messages, status, error, sendMessage, stop } = chat;

  // sendMessage/stop are bound to a Chat instance that only changes with
  // sessionId, so these stay referentially stable across renders.
  const submit = useCallback(
    (params: SubmitParams) =>
      sendMessage({
        text: params.userText,
        metadata: {
          mode: params.mode,
          model: params.model,
        },
      }),
    [sendMessage],
  );

  return useMemo(
    () => ({
      messages,
      status,
      error,
      submit,
      abort: stop,
      interrupt: stop,
    }),
    [messages, status, error, submit, stop],
  );
}
