import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import sessions from "./routes/sessions";

// onError must be chained, not called separately —
// separate calls don't carry route types into typeof app
const app = new Hono()
  .onError((error, c) => {
    if (error instanceof HTTPException) {
      return c.json({ error: error.message || "Request failed" }, error.status);
    }
    console.error("Unhandled server error", error);
    return c.json({ error: "Internal server error" }, 500);
  })
  .route("/sessions", sessions);

export type AppType = typeof app;
export default { port: 3000, fetch: app.fetch, idleTimeout: 255 };
