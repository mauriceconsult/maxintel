import { Hono } from "hono";
import { z } from "zod";
import { generateText } from "ai";
import { isSupportedChatModel, resolveChatModel } from "../lib/models";
import { billingMiddleware, buildUpgradeResponse } from "../middleware/billing";
import type { PlatformVariables } from "../types/context";
import type { SupportedChatModelId } from "@maxintel/shared";
import { checkCredits, deductCredits } from "../lib/credits";

const PLATFORM_DEFAULT_MODEL = "gemini-2.5-flash-lite";
const DEFAULT_TOKENS = 2_048;
const GENERATE_TIMEOUT_MS = 60_000;

const generateSchema = z.object({
  prompt: z.string().min(1),
  type: z.string().optional(),
  model: z
    .string()
    .refine(isSupportedChatModel, "Unsupported model")
    .optional(),
  system: z.string().optional(),
  maxTokens: z.number().int().positive().max(8_192).optional(),
  requestId: z.string().optional(),
});

const app = new Hono<PlatformVariables>()

  // billingMiddleware runs on every route in this router:
  // ✓ Resolves client from API key
  // ✓ Rejects if inactive or zero balance (with upgrade nudge)
  // ✓ Attaches client to context
  .use("*", billingMiddleware)

  .post("/generate", async (c) => {
    // Client is already resolved and zero-balance checked by middleware
    const client = c.get("client");

    const raw = await c.req.text().catch(() => "");
    if (!raw.trim()) return c.json({ error: "Request body is empty" }, 400);

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return c.json({ error: "Request body must be valid JSON" }, 400);
    }

    const parsed = generateSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: "Invalid request body",
          details: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
        400,
      );
    }

    const {
      prompt,
      type,
      system,
      maxTokens = DEFAULT_TOKENS,
      requestId,
    } = parsed.data;

    const envDefault = Bun.env.PLATFORM_DEFAULT_MODEL;
    const modelId = (parsed.data.model ??
      (envDefault && isSupportedChatModel(envDefault)
        ? envDefault
        : PLATFORM_DEFAULT_MODEL)) as SupportedChatModelId;

    // ── Model-specific credit check (middleware can't do this — needs modelId) ─
    const creditCheck = await checkCredits(client.id, modelId, maxTokens);

    if (!creditCheck.ok && creditCheck.reason !== "inactive_client") {
      // Return structured upgrade nudge — calling app renders the top-up modal
      return c.json(
        buildUpgradeResponse(
          client.name,
          creditCheck.balance,
          creditCheck.required,
          modelId,
        ),
        402,
      );
    }

    const resolved = resolveChatModel(modelId);
    const requestKey = requestId ?? crypto.randomUUID();
    const startMs = Date.now();

    try {
      const result = await generateText({
        model: resolved.model,
        system: system ?? "You are a helpful assistant.",
        messages: [{ role: "user", content: prompt }],
        maxOutputTokens: maxTokens, 
        abortSignal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
      });

      const durationMs = Date.now() - startMs;
      const promptTokens = result.usage.inputTokens ?? 0; 
      const completionTokens = result.usage.outputTokens ?? 0; 

      const { creditsUsed, balanceAfter } = await deductCredits({
        clientId: client.id,
        requestId: requestKey,
        model: modelId,
        provider: resolved.provider,
        promptTokens,
        completionTokens,
        generationType: type,
        durationMs,
      });

      return c.json({
        output: result.text,
        provider: resolved.provider,
        model: modelId,
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        creditsUsed,
        creditsRemaining: balanceAfter,
        // Low-balance warning — calling app can show a top-up reminder proactively
        ...(balanceAfter < 100 && {
          warning: {
            code: "LOW_BALANCE",
            balance: balanceAfter,
            message: `Only ${balanceAfter} credits remaining`,
            topUpUrl: "/billing/topup",
          },
        }),
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return c.json({ error: "Generation timed out" }, 504);
      }
      console.error("[platform/generate]", err);
      return c.json({ error: "Generation failed" }, 500);
    }
  })

  .get("/health", (c) => {
    const client = c.get("client");
    return c.json({
      ok: true,
      service: "maxintel-platform",
      client: client.name,
      creditBalance: client.creditBalance,
      defaultModel: Bun.env.PLATFORM_DEFAULT_MODEL ?? PLATFORM_DEFAULT_MODEL,
    });
  });

export default app;
