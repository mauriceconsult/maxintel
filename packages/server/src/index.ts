import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import sessions from "./routes/sessions";
import { sentry } from "@sentry/hono/bun";
import * as Sentry from "@sentry/hono/bun";
import chat from "./routes/chat";

// ── Typed routes — method-chained so AppType resolves correctly ───────────────
// AppType is derived from this, not from the server wrapper below.
const routes = new Hono()

  .get("/debug-sentry", () => {
    Sentry.logger.info("User triggered test error", {
      action: "test_error_endpoint",
    });
    Sentry.metrics.count("test_counter", 1);
    throw new Error("My first Sentry error!");
  })
  .route("/sessions", sessions)
  .route("/chat", chat);

// ── Server wrapper — Sentry + error handler, not part of AppType ──────────────
// Sentry needs a reference to the app it wraps, so it can't be in the chain.
const app = new Hono();

app.use(
  sentry(app, {
    dsn: process.env.SENTRY_DSN, // ← moved to env var (see below)
    tracesSampleRate: 1.0,
    enableLogs: true,
    dataCollection: {
      userInfo: false,
      httpBodies: [],
    },
  }),
);
app.get("/debug-sentry", () => {
  // Send a log before throwing the error
  Sentry.logger.info("User triggered test error", {
    action: "test_error_endpoint",
  });
  // Send a test metric before throwing the error
  Sentry.metrics.count("test_counter", 1);
  throw new Error("My first Sentry error!");
});

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
  return c.json({ error: "Internal server error" }, 500); // ← removed stray `sessions`
});

app.route("/", routes);

export type AppType = typeof routes;
export default { port: 3000, fetch: app.fetch, idleTimeout: 255 };
