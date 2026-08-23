import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  convertToModelMessages,
  streamText,
  validateUIMessages,
  type InferUITools,
  type LanguageModelUsage,
  type UIMessage,
} from "ai";

import { db } from "@maxintel/database";
import type { Prisma } from "@maxintel/database";

import {
  getToolContracts,
  modeSchema,
  type ModeType,
  type ToolContracts,
} from "@maxintel/shared";

import { buildSystemPrompt } from "../system-prompt";
import {
  assertSufficientCredits,
  recordChatUsage,
} from "../billing/chat-billing";

import { isSupportedChatModel, resolveChatModel } from "../lib/models";
import type { AuthenticatedEnv } from "../middleware/require-auth";

type ChatMessageMetaData = {
  mode?: ModeType;
  model?: string;
  durationMs?: number;
  usage?: LanguageModelUsage;
};

type MaxintelUIMessage = UIMessage<
  ChatMessageMetaData,
  never,
  InferUITools<ToolContracts>
>;

const submitSchema = z.object({
  id: z.string().min(1),

  messages: z
    .array(
      z.custom<MaxintelUIMessage>((value) => {
        return (
          value != null &&
          typeof value === "object" &&
          "id" in value &&
          "parts" in value
        );
      }),
    )
    .min(1),

  mode: modeSchema,

  model: z.string().refine(isSupportedChatModel, "Unsupported model"),
});

const submitValidator = zValidator("json", submitSchema, (result, c) => {
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
});

function hasPendingToolCalls(message: MaxintelUIMessage): boolean {
  return message.parts.some((part) => {
    if (part.type === "dynamic-tool" || part.type.startsWith("tool-")) {
      const state = (part as { state?: string }).state;

      return state !== "output-available" && state !== "output-error";
    }

    return false;
  });
}

const app = new Hono<AuthenticatedEnv>().post(
  "/",
  submitValidator,
  async (c) => {
    const userId = c.get("userId");
    const { id, messages, mode, model } = c.req.valid("json");

    // ── Session ownership ────────────────────────────────────────────────────

    const session = await db.session.findUnique({
      where: {
        id,
        userId,
      },
    });

    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    // ── Resolve model ────────────────────────────────────────────────────────

    const resolvedModel = resolveChatModel(model);

    // ── Billing pre-check ────────────────────────────────────────────────────
    //
    // This also creates the user's ApiClient automatically if this is their
    // first generation request.

    const billing = await assertSufficientCredits({
      userId,
      modelId: resolvedModel.modelId,
    });

    if (!billing.ok) {
      return c.json(billing.body, billing.status);
    }

    // ── Prepare messages ─────────────────────────────────────────────────────

    const startTime = Date.now();

    const tools = getToolContracts(mode);

    const previousMessages = Array.isArray(session.messages)
      ? (session.messages as unknown as MaxintelUIMessage[])
      : [];

    const mergedMessages = [...previousMessages];

    for (const message of messages) {
      const incomingMessage = {
        ...message,
        metadata: {
          ...message.metadata,
          mode,
          model,
        },
      } satisfies MaxintelUIMessage;

      const existingMessageIndex = mergedMessages.findIndex(
        (existing) => existing.id === incomingMessage.id,
      );

      if (existingMessageIndex === -1) {
        mergedMessages.push(incomingMessage);
      } else {
        mergedMessages[existingMessageIndex] = incomingMessage;
      }
    }

    const nextMessages = await validateUIMessages<MaxintelUIMessage>({
      messages: mergedMessages,
      tools,
    });

    const modelMessages = await convertToModelMessages(nextMessages, { tools });

    // ── Generate ─────────────────────────────────────────────────────────────

    let completedUsage: LanguageModelUsage | null = null;

    const result = streamText({
      model: resolvedModel.model,
      system: buildSystemPrompt({ mode }),
      messages: modelMessages,
      tools,
      providerOptions: resolvedModel.providerOptions,

      onFinish(event) {
        completedUsage = event.totalUsage;
      },
    });

    // ── Return UI stream ─────────────────────────────────────────────────────

    return result.toUIMessageStreamResponse<MaxintelUIMessage>({
      originalMessages: nextMessages,

      messageMetadata({ part }) {
        if (part.type === "start") {
          return {
            mode,
            model,
          };
        }

        if (part.type !== "finish") {
          return undefined;
        }

        return {
          mode,
          model,
          durationMs: Date.now() - startTime,
          ...(completedUsage ? { usage: completedUsage } : {}),
        };
      },

      async onFinish(event) {
        // Do not bill aborted generations.
        if (event.isAborted) {
          return;
        }

        // Do not persist/bill an incomplete tool interaction.
        if (hasPendingToolCalls(event.responseMessage)) {
          return;
        }

        // ── Persist conversation ────────────────────────────────────────────

        await db.session.update({
          where: {
            id,
            userId,
          },
          data: {
            messages: event.messages as unknown as Prisma.InputJsonValue,
          },
        });

        // Nothing to bill if the provider returned no usage.
        if (!completedUsage) {
          return;
        }

        // ── Record exact usage ──────────────────────────────────────────────

        try {
          /*
           * AI SDK 7 LanguageModelUsage uses inputTokens/outputTokens.
           *
           * Our billing layer deliberately uses the provider-neutral names
           * promptTokens/completionTokens, so translate here.
           */
          const promptTokens = completedUsage.inputTokens ?? 0;

          const completionTokens = completedUsage.outputTokens ?? 0;

          await recordChatUsage({
            userId,
            clientId: billing.clientId,
            requestId: event.responseMessage.id,
            model: resolvedModel.modelId,
            promptTokens,
            completionTokens,
            durationMs: Date.now() - startTime,
            generationType: "chat",
          });
        } catch (error) {
          /*
           * Generation already succeeded. Do not replace the successful
           * streamed response with a billing error. Log the failure so it
           * can be investigated/reconciled.
           */
          console.error("[chat] Failed to record usage", {
            error,
            userId,
            clientId: billing.clientId,
            sessionId: id,
            messageId: event.responseMessage.id,
            model: resolvedModel.modelId,
          });
        }
      },

      onError(error) {
        return error instanceof Error ? error.message : String(error);
      },
    });
  },
);

export default app;
