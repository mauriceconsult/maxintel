import {
  assertSufficientCredits,
  recordChatUsage,
} from "../billing/chat-billing";
import type { Prisma } from "@maxintel/database";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import {
  streamText as aiStreamText,
  stepCountIs,
  type LanguageModelUsage,
} from "ai";

import { db } from "@maxintel/database";
import { Mode, MessageStatus } from "@maxintel/database/enums";
import {
  type ChatStreamEvent,
  type MessagePart,
  toolCallArgsSchema,
  messagePartsSchema,
  type SupportedChatModelId,
} from "@maxintel/shared";

import { zValidator } from "@hono/zod-validator";
import { createTools } from "../tools";
import { buildSystemPrompt } from "../system-prompt";
import { isSupportedChatModel, resolveChatModel } from "../lib/models";
import type { AuthenticatedEnv } from "../middleware/require-auth";

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const MAX_HISTORY_MESSAGES = 20;
const MAX_TOOL_RESULT_CHARS = 8_000;

// -----------------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------------

const submitSchema = z.object({
  content: z.string().min(1, "Content is required"),
  mode: z.enum(Mode),
  model: z.string().refine(isSupportedChatModel, {
    message: "Unsupported model",
  }),
});

// -----------------------------------------------------------------------------
// State
// -----------------------------------------------------------------------------

const activeResumeSessionIds = new Set<string>();

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function truncateToolResult(value: string): string {
  if (value.length <= MAX_TOOL_RESULT_CHARS) return value;
  return (
    value.slice(0, MAX_TOOL_RESULT_CHARS) +
    `\n...[truncated ${value.length - MAX_TOOL_RESULT_CHARS} chars]`
  );
}

function buildConversationHistory(
  messages: {
    role: "USER" | "ASSISTANT" | "ERROR";
    content: string;
    status: MessageStatus;
  }[],
) {
  const windowed = messages.slice(-MAX_HISTORY_MESSAGES);

  return windowed.flatMap((m) => {
    if (m.role === "ERROR") return [];
    if (m.role === "ASSISTANT" && m.content.length === 0) return [];
    return [
      {
        role: m.role === "USER" ? ("user" as const) : ("assistant" as const),
        content: m.content,
      },
    ];
  });
}

function getResumableUserMessage(
  messages: {
    role: "USER" | "ASSISTANT" | "ERROR";
    model: string;
    mode: Mode;
  }[],
) {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "USER") return null;
  return last;
}

// -----------------------------------------------------------------------------
// AI streaming
// -----------------------------------------------------------------------------

type StreamParams = {
  sessionId: string;
  userId: string;
  clientId: string;
  model: string;
  cwd: string | null;
  history: { role: "user" | "assistant"; content: string }[];
  mode: Mode;
  abortController: AbortController;
};

async function streamAIResponse(
  stream: Parameters<Parameters<typeof streamSSE>[1]>[0],
  params: StreamParams,
) {
  const { sessionId, mode, cwd, history, abortController, model } = params;
  // userId reserved for usage metering / per-user limits
  const startTime = Date.now();
  const tools = cwd ? createTools(cwd, mode) : undefined;
  const parts: MessagePart[] = [];
  const resolvedModel = resolveChatModel(model);

  let completedUsage: LanguageModelUsage | null = null;

  const persistInterruptedMessage = async () => {
    const fullText = parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("");

    if (fullText.length === 0 && parts.length === 0) return;

    const elapsedMs = Date.now() - startTime;
    const validatedParts: Prisma.InputJsonValue | undefined =
      parts.length > 0
        ? (messagePartsSchema.parse(parts) as Prisma.InputJsonValue)
        : undefined;

    await db.message.create({
      data: {
        sessionId,
        role: "ASSISTANT",
        status: MessageStatus.INTERRUPTED,
        model,
        content: fullText,
        parts: validatedParts,
        mode,
        duration: Math.round(elapsedMs / 1000),
      },
    });
  };

  try {
    const result = aiStreamText({
      model: resolvedModel.model,
      system: buildSystemPrompt({ cwd, mode }),
      messages: history,
      tools,
      stopWhen: tools ? stepCountIs(50) : undefined,
      abortSignal: abortController.signal,
      providerOptions: resolvedModel.providerOptions,
      onFinish: ({ usage }) => {
        completedUsage = usage;
      },
    });

    for await (const part of result.fullStream) {
      if (stream.aborted || abortController.signal.aborted) break;

      if (part.type === "reasoning-delta") {
        const last = parts[parts.length - 1];
        if (last?.type === "reasoning") {
          last.text += part.text;
        } else {
          parts.push({ type: "reasoning", text: part.text });
        }
        await stream.writeSSE({
          event: "reasoning-delta",
          data: JSON.stringify({
            type: "reasoning-delta",
            text: part.text,
          } satisfies ChatStreamEvent),
        });
        continue;
      }

      if (part.type === "text-delta") {
        const last = parts[parts.length - 1];
        if (last?.type === "text") {
          last.text += part.text;
        } else {
          parts.push({ type: "text", text: part.text });
        }
        await stream.writeSSE({
          event: "text-delta",
          data: JSON.stringify({
            type: "text-delta",
            text: part.text,
          } satisfies ChatStreamEvent),
        });
        continue;
      }

      if (part.type === "tool-call") {
        const args = toolCallArgsSchema.parse(part.input);
        parts.push({
          type: "tool-call",
          id: part.toolCallId,
          name: part.toolName,
          args,
        });
        await stream.writeSSE({
          event: "tool-call",
          data: JSON.stringify({
            type: "tool-call",
            id: part.toolCallId,
            name: part.toolName,
            args,
          } satisfies ChatStreamEvent),
        });
        continue;
      }

      if (part.type === "tool-result") {
        const raw =
          typeof part.output === "string"
            ? part.output
            : JSON.stringify(part.output);
        const resultStr = truncateToolResult(raw);

        const tcPart = parts.find(
          (p): p is Extract<MessagePart, { type: "tool-call" }> =>
            p.type === "tool-call" && p.id === part.toolCallId,
        );
        if (tcPart) tcPart.result = resultStr;

        await stream.writeSSE({
          event: "tool-result",
          data: JSON.stringify({
            type: "tool-result",
            toolCallId: part.toolCallId,
            result: resultStr,
          } satisfies ChatStreamEvent),
        });
        continue;
      }

      if (part.type === "finish") {
        // some SDK versions expose usage here as well
        if ("usage" in part && part.usage) {
          completedUsage = part.usage as LanguageModelUsage;
        }
        continue;
      }

      if (part.type === "error") {
        throw part.error;
      }
    }

    if (stream.aborted || abortController.signal.aborted) {
      await persistInterruptedMessage();
      return;
    }

    // Prefer onFinish usage; fall back to result.usage if needed
    if (!completedUsage) {
      try {
        completedUsage = await result.usage;
      } catch {
        completedUsage = null;
      }
    }

    const elapsedMs = Date.now() - startTime;
    const fullText = parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("");

    const validatedParts: Prisma.InputJsonValue | undefined =
      parts.length > 0
        ? (messagePartsSchema.parse(parts) as unknown as Prisma.InputJsonValue)
        : undefined;

    const assistantMessage = await db.message.create({
      data: {
        sessionId,
        role: "ASSISTANT",
        status: MessageStatus.COMPLETE,
        model,
        content: fullText,
        parts: validatedParts,
        mode,
        duration: Math.round(elapsedMs / 1000),
      },
    });

    // Hook for billing: map userId → ApiClient later
   if (completedUsage) {
  try {
    await recordChatUsage({
      userId: params.userId,
      clientId: params.clientId,
      requestId: assistantMessage.id,
      model,
      promptTokens: completedUsage.inputTokens ?? 0,
      completionTokens: completedUsage.outputTokens ?? 0,
      durationMs: elapsedMs,
    });
  } catch (err) {
    console.error("[chat] recordChatUsage failed:", err);
  }
}

await stream.writeSSE({
  event: "done",
  data: JSON.stringify({
    type: "done",
    messageId: assistantMessage.id,
    durationMs: elapsedMs,
  } satisfies ChatStreamEvent),
});
  } catch (err) {
    if (abortController.signal.aborted) {
      await persistInterruptedMessage();
      return;
    }

    const message = err instanceof Error ? err.message : String(err);
    console.error("[chat] AI error:", err);

    await db.message.create({
      data: {
        sessionId,
        role: "ERROR",
        status: MessageStatus.COMPLETE,
        model,
        content: message,
        mode,
      },
    });

    await stream.writeSSE({
      event: "error",
      data: JSON.stringify({
        type: "error",
        message,
      } satisfies ChatStreamEvent),
    });
  }
}

// -----------------------------------------------------------------------------
// Routes
// -----------------------------------------------------------------------------

const app = new Hono<AuthenticatedEnv>()
  .post("/:sessionId/resume", async (c) => {
    const sessionId = c.req.param("sessionId");
    const userId = c.get("userId");

    const session = await db.session.findUnique({
      where: { id: sessionId, userId },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!session) return c.json({ error: "Session not found" }, 404);

    const resumableMessage = getResumableUserMessage(session.messages);
    if (!resumableMessage) {
      return c.json(
        { error: "Session has no pending user message to resume" },
        409,
      );
    }
    if (!isSupportedChatModel(resumableMessage.model)) {
      return c.json(
        { error: `Session uses unsupported model: ${resumableMessage.model}` },
        409,
      );
    }

const gate = await assertSufficientCredits({
  userId,
  modelId: resumableMessage.model as SupportedChatModelId,
});

if (!gate.ok) {
  return c.json(gate.body, gate.status);
}

if (activeResumeSessionIds.has(sessionId)) {
  return c.json({ error: "Session already has an active resume" }, 409);
}

activeResumeSessionIds.add(sessionId);

const history = buildConversationHistory(session.messages);
const abortController = new AbortController();

try {
  return streamSSE(
    c,
    async (stream) => {
      stream.onAbort(() => abortController.abort());

      try {
        await streamAIResponse(stream, {
          sessionId,
          userId,
          clientId: gate.clientId,
          model: resumableMessage.model,
          cwd: session.cwd,
          history,
          mode: resumableMessage.mode,
          abortController,
        });
      } finally 
          {
            activeResumeSessionIds.delete(sessionId);
          }
        },
        async (err, stream) => {
          activeResumeSessionIds.delete(sessionId);
          const message = err instanceof Error ? err.message : String(err);
          await stream.writeSSE({
            event: "error",
            data: JSON.stringify({
              type: "error",
              message,
            } satisfies ChatStreamEvent),
          });
        },
      );
    } catch (error) {
      activeResumeSessionIds.delete(sessionId);
      throw error;
    }
  })
  .post(
    "/:sessionId",
    zValidator("json", submitSchema, (result, c) => {
      if (!result.success) {
        return c.json(
          {
            error: "Invalid request body",
            details: result.error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
            })),
          },
          400,
        );
      }
    }),
    async (c) => {
      const sessionId = c.req.param("sessionId");
      const data = c.req.valid("json");
      const userId = c.get("userId");

   const gate = await assertSufficientCredits({
     userId,
     modelId: data.model,
   });

   if (!gate.ok) {
     return c.json(gate.body, gate.status);
   }

      const session = await db.session.findUnique({
        where: { id: sessionId, userId },
        include: { messages: { orderBy: { createdAt: "asc" } } },
      });
      if (!session) {
        return c.json({ error: "Session not found" }, 404);
      }

      await db.message.create({
        data: {
          sessionId,
          role: "USER",
          status: MessageStatus.COMPLETE,
          model: data.model,
          content: data.content,
          mode: data.mode,
        },
      });

      const history = buildConversationHistory([
        ...session.messages,
        {
          role: "USER" as const,
          content: data.content,
          status: MessageStatus.COMPLETE,
        },
      ]);

      const abortController = new AbortController();

      return streamSSE(
        c,
        async (stream) => {
          stream.onAbort(() => abortController.abort());
          await streamAIResponse(stream, {
            sessionId,
            userId,
            clientId: gate.clientId,
            model: data.model,
            cwd: session.cwd,
            history,
            mode: data.mode,
            abortController,
          });
        },
        async (err, stream) => {
          const message = err instanceof Error ? err.message : String(err);
          await stream.writeSSE({
            event: "error",
            data: JSON.stringify({
              type: "error",
              message,
            } satisfies ChatStreamEvent),
          });
        },
      );
    },
  ); 

export default app;
