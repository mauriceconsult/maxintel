import { Hono } from "hono";
import { logger } from "hono/logger";
import { HTTPException } from "hono/http-exception";
import * as Sentry from "@sentry/node";

import sessions from "./routes/sessions";
import chat from "./routes/chat";
import platform from "./routes/platform";
import auth from "./routes/auth";
import billing from "./routes/billing";
import admin from "./routes/admin";
import { requireAuth } from "./middleware/require-auth";

export const app = new Hono();

// 1. Global Logging
app.use("*", logger());

// 2. Sentry Request Tracing & Context
app.use("*", async (c, next) => {
  Sentry.setTag("path", c.req.path);
  Sentry.setTag("method", c.req.method);
  await next();
});

// 3. Auth Middleware for Protected Routes
app.use("/sessions/*", requireAuth);
app.use("/chat/*", requireAuth);

// 4. Mount Sub-Routers
// The chained `.route()` result carries the route schema that Hono's RPC client
// infers from. It must be captured — `typeof app` alone is a BlankSchema.
export const routes = app
  .route("/sessions", sessions)
  .route("/chat", chat)
  .route("/platform", platform)
  .route("/auth", auth)
  .route("/billing", billing)
  .route("/admin", admin);

export type AppType = typeof routes;

// 5. Global Error Handler
app.onError((error, c) => {
  if (error instanceof HTTPException) {
    return c.json({ error: error.message || "Request failed" }, error.status);
  }

  Sentry.captureException(error, {
    extra: {
      path: c.req.path,
      method: c.req.method,
    },
  });

  return c.json({ error: "Internal server error" }, 500);
});
