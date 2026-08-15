import { Hono } from "hono";
import { z } from "zod";
import { generateText } from "ai";
import type { Context } from "hono";
import { isSupportedChatModel, resolveChatModel } from "../lib/models";

// ── Constants ──────────────────────────────────────────────────────────────────

const PLATFORM_DEFAULT_MODEL = "gemini-2.5-flash-lite"; // cheapest capable default
const MAX_TOKENS_CEILING = 8_192;
const DEFAULT_TOKENS = 2_048;
const GENERATE_TIMEOUT_MS = 60_000;

// ── Validation ─────────────────────────────────────────────────────────────────

const generateSchema = z.object({
  prompt: z.string().min(1, "prompt is required"),
  type: z.string().optional(), // Studio generation type, passed through
  model: z
    .string()
    .refine(isSupportedChatModel, { message: "Unsupported model" })
    .optional(),
  system: z.string().optional(),
  maxTokens: z.number().int().positive().max(MAX_TOKENS_CEILING).optional(),
});

// ── Auth ───────────────────────────────────────────────────────────────────────

type AuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 500; error: string };

function assertPlatformKey(c: Context): AuthResult {
  const expected = Bun.env.PLATFORM_API_KEY;

  if (!expected) {
    console.error("[platform] PLATFORM_API_KEY is not set");
    return { ok: false, status: 500, error: "Server misconfigured" };
  }

  // Accept both Authorization: Bearer <key> and X-Platform-Key: <key>
  const provided =
    c.req.header("Authorization")?.replace(/^Bearer\s+/i, "") ??
    c.req.header("X-Platform-Key");

  if (!provided || provided !== expected) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  return { ok: true };
}

// ── Routes ─────────────────────────────────────────────────────────────────────

const app = new Hono()

  .post("/generate", async (c) => {
    // ── Auth ────────────────────────────────────────────────────────────────
    const auth = assertPlatformKey(c);
    if (!auth.ok) return c.json({ error: auth.error }, auth.status);

    // ── Body parsing ─────────────────────────────────────────────────────────
    // Manual parse kept intentionally — zValidator calls c.req.json() internally
    // which throws an unhandled "Failed to parse JSON" on empty/malformed bodies.
    // Parsing from c.req.text() gives us control over the error response.
    const raw = await c.req.text().catch(() => "");

    if (!raw.trim()) {
      return c.json({ error: "Request body is empty" }, 400);
    }

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
      system,
      model: requestedModel,
      maxTokens = DEFAULT_TOKENS,
    } = parsed.data;

    // ── Model resolution ──────────────────────────────────────────────────────
    // Priority: request → PLATFORM_DEFAULT_MODEL env → hardcoded fallback.
    // Validate the env var because it's an unchecked string at runtime.
    const envDefault = Bun.env.PLATFORM_DEFAULT_MODEL;
    const modelId =
      requestedModel ??
      (envDefault && isSupportedChatModel(envDefault)
        ? envDefault
        : PLATFORM_DEFAULT_MODEL);

    // Catches an invalid PLATFORM_DEFAULT_MODEL env var
    if (!isSupportedChatModel(modelId)) {
      return c.json({ error: `Unsupported model: ${modelId}` }, 400);
    }

    const resolved = resolveChatModel(modelId);

    // ── Generate ──────────────────────────────────────────────────────────────
    try {
      const result = await generateText({
        model: resolved.model,
        system: system ?? "You are a helpful assistant.",
        messages: [{ role: "user", content: prompt }],
        maxOutputTokens: maxTokens,
        abortSignal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
      });

      // AI SDK v4 usage fields
      const promptTokens = result.usage.inputTokens ?? 0;
      const completionTokens = result.usage.outputTokens ?? 0;

      return c.json({
        output: result.text,
        provider: resolved.provider,
        model: modelId,
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      });
    } catch (err) {
      // Timeout
      if (err instanceof Error && err.name === "AbortError") {
        return c.json({ error: "Generation timed out" }, 504);
      }
      // Log full detail server-side; return a generic message to the caller
      // so internal error strings don't leak to Studio or its users
      console.error("[platform/generate] failed:", err);
      return c.json({ error: "Generation failed" }, 500);
    }
  })

  .get("/health", (c) => {
    return c.json({
      ok: true,
      service: "maxintel-platform",
      default: {
        model: Bun.env.PLATFORM_DEFAULT_MODEL ?? PLATFORM_DEFAULT_MODEL,
      },
    });
  });

export default app;
