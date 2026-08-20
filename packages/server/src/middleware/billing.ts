// packages/server/src/middleware/billing.ts

import { createMiddleware } from "hono/factory";
import { db } from "@maxintel/database";
import type { PlatformVariables } from "../types/context";

export const billingMiddleware = createMiddleware<PlatformVariables>(
  async (c, next) => {
    // ── Resolve API key ───────────────────────────────────────────────────────
    const apiKey =
      c.req.header("X-Platform-Key") ??
      c.req.header("Authorization")?.replace(/^Bearer\s+/i, "");

    if (!apiKey) {
      return c.json({ error: "API key required" }, 401);
    }

    const client = await db.apiClient.findUnique({
      where: { apiKey },
      select: {
        id: true,
        name: true,
        creditBalance: true,
        isActive: true,
        monthlySpendCap: true,
      },
    });

    if (!client || !client.isActive) {
      return c.json({ error: "Invalid or inactive API key" }, 401);
    }

    // ── Zero-balance gate (fast path — no body parsing needed) ────────────────
    if (client.creditBalance <= 0) {
      return c.json(buildUpgradeResponse(client.name, 0, null), 402);
    }

    // Attach to context for the route handler
    c.set("client", client);
    await next();
  },
);

// ── Shared upgrade response shape ─────────────────────────────────────────────
// Same structure whether triggered by zero balance (middleware)
// or insufficient credits for a specific model (route handler).
// Calling apps (Studio, Instaskul) read this to render the upgrade modal.
export function buildUpgradeResponse(
  clientName: string,
  balance: number,
  required: number | null,
  modelId?: string,
) {
  return {
    error: "Insufficient credits",
    code: "PAYMENT_REQUIRED", // machine-readable for client apps
    client: clientName,
    balance,
    required,
    shortfall: required !== null ? Math.max(0, required - balance) : null,
    model: modelId ?? null,
    upgrade: {
      url: "/billing/upgrade", // Maxintel's upgrade info endpoint
      topUpUrl: "/billing/topup", // direct MoMo top-up
      bundlesUrl: "/billing/bundles", // pricing page
      message:
        balance <= 0
          ? "Your credit balance is empty. Top up via MTN MoMo to continue."
          : `This request needs ${required} credits but you only have ${balance}.`,
    },
  };
}
