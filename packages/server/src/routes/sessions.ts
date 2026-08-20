import { Hono } from "hono";
import * as Sentry from "@sentry/hono/bun";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
// import { findSupportedChatModel } from "@maxintel/shared";
import { db } from "@maxintel/database";
import { Role, MessageStatus, Mode } from "@maxintel/database/enums";
import type { AuthenticatedEnv } from "../middleware/require-auth";
import { isSupportedChatModel } from "../lib/models";
import { assertSufficientCredits } from "../billing/chat-billing";


const createSessionSchema = z.object({
  title: z.string(),
  cwd: z.string().optional(),
  initialMessage: z
    .object({
      role: z.nativeEnum(Role),
      content: z.string(),
      mode: z.nativeEnum(Mode),
      model: z
        .string()
        .refine(isSupportedChatModel, "Unsupported model"),
    })
    .optional(),
});

// Strip the intersection type so TypeScript can narrow .error
// Extract just the failure shape — strips the intersection so TypeScript
// can resolve .error without the { target: "json" } intersection blocking it.
type SessionValidationFailure = {
  success: false;
  error: z.ZodError<z.infer<typeof createSessionSchema>>;
};

const createSessionValidator = zValidator(
  "json",
  createSessionSchema,
  (result, c) => {
    if (!result.success) {
      const { error } = result as unknown as SessionValidationFailure;
      Sentry.logger.warn("Session creation validator failed", {
        path: c.req.path,
        issues: error.issues.length,
      });
      return c.json({ error: "Invalid request body" }, 400);
    }
  },
);

const app = new Hono<AuthenticatedEnv>()
  .get("/", async (c) => {
    const userId = c.get("userId");
    const sessions = await db.session.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, createdAt: true },
    });
    Sentry.logger.info("Listed sessions", { count: sessions.length });
    return c.json(sessions);
  })
  .get("/:id", async (c) => {
    const id = c.req.param("id");
    const userId = c.get("userId");
    const session = await db.session.findUnique({
      where: { id, userId },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!session) {
      Sentry.logger.warn("Session not found", { sessionId: id });
      return c.json({ error: "Session not found" }, 404);
    }

    Sentry.logger.info("Loaded session", { sessionId: session.id });
    return c.json(session);
  })
  .post("/", createSessionValidator, async (c) => {
    const userId = c.get("userId");
    const { initialMessage, ...data } = c.req.valid("json");

    // If the first message will trigger a generation (CLI auto-resume), gate now
    if (initialMessage) {
      const modelId = initialMessage.model;
      const gate = await assertSufficientCredits({
        userId,
        modelId,
      });
      if (!gate.ok) {
        return c.json(
          {
            error: gate.error,
            balance: gate.balance,
            required: "required" in gate ? gate.required : undefined,
            upgradePath: "/billing/upgrade",
          },
          gate.status,
        );
      }
    }

    const session = await db.session.create({
      data: {
        ...data,
        userId,
        ...(initialMessage && {
          messages: {
            create: { ...initialMessage, status: MessageStatus.COMPLETE },
          },
        }),
      },
      include: { messages: true },
    });

    Sentry.logger.info("Created session", {
      sessionId: session.id,
      title: session.title,
    });
    return c.json(session, 201);
  });

export default app;
