import { app } from "./app";

// Bun runtime entrypoint only.
//
// The application itself lives in app.ts so it can be consumed by
// Vercel's Node.js runtime (or another HTTP adapter) without importing
// Bun-specific server configuration.

export default {
  port: Number(process.env.PORT ?? 3000),
  fetch: app.fetch,
  idleTimeout: 255,
};
export { app, routes } from "./app";
export type { AppType } from "./app";
