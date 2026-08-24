import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { sentry } from "@sentry/hono/node";
import * as Sentry from "@sentry/node";

import sessions from "./routes/sessions";
import chat from "./routes/chat";
import platform from "./routes/platform";
import auth from "./routes/auth";
import billing from "./routes/billing";
import admin from "./routes/admin";
import { requireAuth } from "./middleware/require-auth";

export const routes = new Hono()
  .route("/sessions", sessions)
  .route("/chat", chat)
  .route("/platform", platform)
  .route("/auth", auth)
  .route("/billing", billing)
  .route("/admin", admin);

export type AppType = typeof routes;

export const app = new Hono();

// Sentry must be initialized before this middleware.
// instrument.ts handles Sentry.init().
app.use("*", sentry(app));

app.use("*", async (c, next) => {
  console.log(`[request] ${c.req.method} ${c.req.path}`);
  await next();
});

app.onError((error, c) => {
  if (error instanceof HTTPException) {
    Sentry.logger.warn("Handled HTTP error", {
      status: error.status,
      path: c.req.path,
    });

    return c.json({ error: error.message || "Request failed" }, error.status);
  }

  Sentry.logger.error("Unhandled server error", {
    path: c.req.path,
    message: error instanceof Error ? error.message : "Unknown error",
  });

  return c.json({ error: "Internal server error" }, 500);
});

app.use("/sessions/*", requireAuth);
app.use("/chat/*", requireAuth);

app.route("/", routes);
