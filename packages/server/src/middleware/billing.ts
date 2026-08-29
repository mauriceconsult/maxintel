// packages/server/src/middleware/billing.ts

import { createMiddleware } from "hono/factory";
import { db } from "@maxintel/database";
import { buildCheckoutUrl, publicBaseUrl } from "../lib/checkout-token";
import { UGX_PER_CREDIT, CREDIT_BUNDLES } from "../lib/pricing";
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
      return c.json(buildUpgradeResponse(client, 0, null), 402);
    }

    // Attach to context for the route handler
    c.set("client", client);
    await next();
  },
);

// ── Shared upgrade response shape ─────────────────────────────────────────────
// Same structure whether triggered by zero balance (middleware)
// or insufficient credits for a specific model (route handler).
// Calling apps (Studio, Instaskul) read this to render the upgrade modal;
// the CLI opens `upgrade.checkoutUrl` in a browser.
export function buildUpgradeResponse(
  client: { id: string; name: string },
  balance: number,
  required: number | null,
  modelId?: string,
  /** Where the browser should land once the top-up confirms */
  returnUrl?: string | null,
) {
  const shortfall = required !== null ? Math.max(0, required - balance) : null;

  // Signed, 30-minute link — safe to open in a browser, email or paste in a
  // terminal, because it carries no API key.
  const checkoutUrl = buildCheckoutUrl({
    clientId: client.id,
    returnUrl,
    required: shortfall,
    model: modelId,
  });

  // The cheapest bundle that actually unblocks the caller. Surfacing it here
  // means a client app can render "Top up 1,000 credits — UGX 5,000" without a
  // second round trip to /billing/bundles.
  const suggested =
    shortfall && shortfall > 0
      ? (CREDIT_BUNDLES.find((b) => b.credits >= shortfall) ??
        CREDIT_BUNDLES[CREDIT_BUNDLES.length - 1])
      : CREDIT_BUNDLES[0];

  return {
    error: "Insufficient credits",
    code: "PAYMENT_REQUIRED", // machine-readable for client apps
    client: client.name,
    balance,
    required,
    shortfall,
    model: modelId ?? null,
    upgrade: {
      // Browser-based MoMo checkout — the one field a caller needs to unblock
      // a user. Everything below it is detail for richer in-app UIs.
      checkoutUrl,
      method: "MTN_MOMO",
      ugxPerCredit: UGX_PER_CREDIT,
      suggestedBundle: suggested
        ? {
            id: suggested.id,
            credits: suggested.credits,
            ugx: suggested.ugx,
            priceLabel: `UGX ${suggested.ugx.toLocaleString()}`,
          }
        : null,
      // Kept for existing callers that still hit these JSON endpoints.
      url: `${publicBaseUrl()}/billing/upgrade`,
      topUpUrl: `${publicBaseUrl()}/billing/topup`,
      bundlesUrl: `${publicBaseUrl()}/billing/bundles`,
      message:
        balance <= 0
          ? "Your credit balance is empty. Open the checkout link to top up with MTN MoMo."
          : `This request needs ${required?.toLocaleString()} credits but you only have ${balance.toLocaleString()}. Open the checkout link to top up with MTN MoMo.`,
    },
  };
}
