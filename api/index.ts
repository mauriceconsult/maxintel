import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = {
  runtime: "nodejs",
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { app } = await import("../packages/server/src/app");
  const { handle } = await import("@hono/node-server/vercel");

  return handle(app)(req, res);
}
