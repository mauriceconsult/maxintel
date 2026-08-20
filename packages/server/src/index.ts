import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import * as Sentry from "@sentry/hono/bun";
import { sentry } from "@sentry/hono/bun";

import sessions from "./routes/sessions";
import chat from "./routes/chat";
import platform from "./routes/platform";
import auth from "./routes/auth";
import billing from "./routes/billing";
import admin from "./routes/admin";
import { requireAuth } from "./middleware/require-auth";

// ── Typed routes (AppType) ────────────────────────────────────────────────────
const routes = new Hono()
  .get("/debug-sentry", () => {
    Sentry.logger.info("User triggered test error", {
      action: "test_error_endpoint",
    });
    Sentry.metrics.count("test_counter", 1);
    throw new Error("My first Sentry error!");
  })
  .route("/sessions", sessions)
  .route("/chat", chat)
  .route("/platform", platform)
  .route("/auth", auth)
  .route("/billing", billing)
  .route("/admin", admin);

// ── App wrapper ───────────────────────────────────────────────────────────────
const app = new Hono();

app.use("*", async (c, next) => {
  console.log(`[request] ${c.req.method} ${c.req.path}`);
  await next();
});

app.use(
  sentry(app, {
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 1.0,
    enableLogs: true,
    dataCollection: {
      userInfo: false,
      httpBodies: [],
    },
  }),
);

app.onError((error, c) => {
  if (error instanceof HTTPException) {
    Sentry.logger.warn("Handled HTTP error", {
      status: error.status,
      message: error.message || "Request failed",
      path: c.req.path,
      method: c.req.method,
    });
    return c.json({ error: error.message || "Request failed" }, error.status);
  }
  Sentry.logger.error("Unhandled server error", {
    path: c.req.path,
    method: c.req.method,
    message: error instanceof Error ? error.message : "Unknown error",
  });
  return c.json({ error: "Internal server error" }, 500);
});

// User JWT — only CLI session/chat surfaces
app.use("/sessions/*", requireAuth);
app.use("/chat/*", requireAuth);
// Do NOT requireAuth on /platform, /billing, /admin, /auth
// (API key / admin key / public webhook)

app.route("/", routes);

export type AppType = typeof routes;
export default { port: 3000, fetch: app.fetch, idleTimeout: 255 };
