import { Hono } from "hono";
import * as Sentry from "@sentry/hono/bun";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "@maxintel/database";
import type { AuthenticatedEnv } from "../middleware/require-auth";

const createSessionSchema = z.object({
  title: z.string(),
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
    const data = c.req.valid("json");

    const session = await db.session.create({
      data: {
        ...data,
        userId,
      },
    });

    Sentry.logger.info("Created session", {
      sessionId: session.id,
      title: session.title,
    });
    return c.json(session, 201);
  });

export default app;
