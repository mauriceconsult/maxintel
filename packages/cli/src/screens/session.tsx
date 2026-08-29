import { useState, useEffect, useMemo, useRef } from "react";
import { useParams, useLocation, useNavigate } from "react-router";
import { z } from "zod";
import type { InferResponseType } from "hono/client";
import { UserMessage, BotMessage, ErrorMessage } from "../components/messages";
import { SessionShell } from "../components/session-shell";
import { useToast } from "../providers/toast";
import { getErrorMessage } from "../lib/http-errors";
import {
  parseInsufficientCredits,
  formatInsufficientCredits,
} from "../lib/upgrade";
import { apiClient } from "../lib/api-client";
import {
  modeSchema,
  type ModeType,
  type SupportedChatModelId,
} from "@maxintel/shared";
import { useChat } from "../hooks/use-chat";
import type { Message } from "../hooks/use-chat";
import { useKeyboard } from "@opentui/react";
import { useKeyboardLayer } from "../providers/keyboard-layer";
import { usePromptConfig } from "../providers/prompt-config";

type SessionData = InferResponseType<
  (typeof apiClient.sessions)[":id"]["$get"],
  200
>;
const sessionLocationSchema = z.object({
  session: z.custom<SessionData>(
    (val) => val != null && typeof val === "object" && "id" in val,
  ),
  initialPrompt: z
    .object({
      message: z.string(),
      mode: modeSchema,
      // The model arrives from the home screen as an id string, not a
      // SupportedChatModel object.
      model: z.custom<SupportedChatModelId>(
        (value) => typeof value === "string" && value.length > 0,
      ),
    })
    .optional(),
});

function ChatMessage({ msg }: { msg: Message }) {
  if (msg.role === "user") {
    const text = msg.parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("");
    return <UserMessage message={text} mode={msg.metadata?.mode ?? "BUILD"} />;
  }
  return (
    <BotMessage
      parts={msg.parts}
      model={msg.metadata?.model ?? "unknown"}
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
  initialPrompt?: {
    message: string;
    mode: ModeType;
    model: SupportedChatModelId;
  };
}) {
  const [initialMessages] = useState(
    () => session.messages as unknown as Message[],
  );
  const { isTopLayer } = useKeyboardLayer();
  const { mode, model } = usePromptConfig();
  const { messages, status, submit, abort, interrupt, error } = useChat(
    session.id,
    initialMessages,
  );
  const hasSubmittedInitialPromptRef = useRef(false);
  useEffect(() => {
    return () => {
      void abort();
    };
  }, [abort]);
  useKeyboard((key) => {
    if (
      key.name === "esacape" &&
      isTopLayer("base") &&
      status === "streaming"
    ) {
      key.preventDefault();
      interrupt();
    }
  });
  useEffect(() => {
    if (!initialPrompt || hasSubmittedInitialPromptRef.current) return;
    hasSubmittedInitialPromptRef.current = true;
    void submit({
      userText: initialPrompt.message,
      mode: initialPrompt.mode,
      model: initialPrompt.model,
    });
  }, [initialPrompt, submit]);
  return (
    <SessionShell
      onSubmit={(text) => submit({ userText: text, mode, model })}
      loading={status === "submitted" || status === "streaming"}
      interruptible={status === "submitted" || status === "streaming"}
    >
      {messages.map((msg) => (
        <ChatMessage key={msg.id} msg={msg} />
      ))}
      {error && <ErrorMessage message={formatChatError(error)} />}
    </SessionShell>
  );
}

// A 402 arrives as a raw JSON body in error.message. Show the top-up sentence
// and the MoMo checkout link instead of the payload.
function formatChatError(error: Error): string {
  const credits = parseInsufficientCredits(error);
  return credits ? formatInsufficientCredits(credits) : error.message;
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
  const [session, setSession] = useState<SessionData | null>(
    prefetched?.session ?? null,
  );
  useEffect(() => {
    if (prefetched?.session) return;
    setSession(null);
    if (!id) return;
    let ignore = false;
    const fetchSession = async () => {
      try {
        const res = await apiClient.sessions[":id"].$get({ param: { id } });
        if (ignore) return;
        if (!res.ok) throw new Error(await getErrorMessage(res));
        const resolved = await res.json();
        setSession(resolved);
      } catch (err) {
        if (ignore) return;
        toast.show({
          variant: "error",
          message:
            err instanceof Error ? err.message : "Failed to load session",
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
    return <SessionShell onSubmit={() => {}} inputDisabled />;
  }

  return (
    <SessionChat
      key={session.id}
      session={session}
      initialPrompt={prefetched?.initialPrompt}
    />
  );
}
