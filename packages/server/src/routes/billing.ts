import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "@maxintel/database";
import { getClientBalance } from "../lib/credits";
import { CREDIT_BUNDLES, UGX_PER_CREDIT } from "../lib/pricing";
import { initiateTopUp, processTopUpWebhook } from "../lib/momo";
import type { AuthenticatedEnv } from "../middleware/require-auth";

// Auth helper shared with platform route
function requireApiKey(c: {
  req: { header: (k: string) => string | undefined };
}) {
  const key =
    c.req.header("X-Platform-Key") ??
    c.req.header("Authorization")?.replace(/^Bearer\s+/i, "");
  return key ?? null;
}

const topUpSchema = z.object({
  bundleId: z.enum(["starter", "growth", "scale", "enterprise"]),
  phone: z.string().min(9),
  successUrl: z.string().url().optional(), // ← portal passes its own return URL
});

const app = new Hono<AuthenticatedEnv>()

  // ── GET /billing/bundles — public pricing page ──────────────────────────────
  .get("/bundles", (c) => {
    return c.json({
      ugxPerCredit: UGX_PER_CREDIT,
      bundles: CREDIT_BUNDLES.map((b) => ({
        id: b.id,
        credits: b.credits,
        ugx: b.ugx,
        discountPct: b.discountPct,
        priceLabel: `UGX ${b.ugx.toLocaleString()}`,
      })),
    });
  })

  // ── GET /billing/balance — client balance + 30-day usage ───────────────────
  .get("/balance", async (c) => {
    const apiKey = requireApiKey(c);
    if (!apiKey) return c.json({ error: "API key required" }, 401);

    const client = await db.apiClient.findUnique({
      where: { apiKey },
      select: { id: true, name: true },
    });
    if (!client) return c.json({ error: "Invalid API key" }, 401);

    const summary = await getClientBalance(client.id);
    return c.json({ client: client.name, ...summary });
  })

  // ── POST /billing/topup — initiate MoMo top-up ─────────────────────────────
  .post("/topup", zValidator("json", topUpSchema), async (c) => {
    const apiKey = requireApiKey(c);
    if (!apiKey) return c.json({ error: "API key required" }, 401);

    const client = await db.apiClient.findUnique({
      where: { apiKey },
      select: { id: true, isActive: true },
    });
    if (!client?.isActive)
      return c.json({ error: "Invalid or inactive client" }, 401);

    const { bundleId, phone, successUrl } = c.req.valid("json");

    try {
      const { referenceId, bundle } = await initiateTopUp({
        clientId: client.id,
        bundleId,
        phone,
        successUrl,
      });

      return c.json({
        referenceId,
        status: "PENDING",
        pollUrl: `/billing/status/${referenceId}`, // ← portal polls this
        message: `Approve the MTN MoMo prompt on ${phone}`,
        bundle: { credits: bundle.credits, ugx: bundle.ugx },
      });
    } catch (err) {
      console.error("[billing/topup]", err);
      return c.json({ error: "Top-up initiation failed" }, 500);
    }
  })

  // ── POST /billing/webhook — MTN MoMo callback (no auth — public MTN endpoint)
  .post("/webhook", async (c) => {
    try {
      const raw = await c.req.text();
      const body = JSON.parse(raw) as { referenceId?: string; status?: string };

      if (body.referenceId && body.status) {
        await processTopUpWebhook(body.referenceId, body.status);
      }
    } catch (err) {
      console.error("[billing/webhook]", err);
    }
    // Always acknowledge to MTN — prevents retry storms
    return c.json({ received: true });
  })

  // GET /billing/status/:referenceId
  // The portal polls this every 3–5 seconds while showing "waiting for approval"
  .get("/status/:referenceId", async (c) => {
    const { referenceId } = c.req.param();

    const tx = await db.creditTransaction.findUnique({
      where: { momoRef: referenceId },
      select: {
        momoStatus: true,
        credits: true,
        ugxAmount: true,
        balanceAfter: true,
        metadata: true,
        createdAt: true,
      },
    });

    if (!tx) return c.json({ error: "Reference not found" }, 404);

    const meta = tx.metadata as Record<string, unknown> | null;
    const successUrl = meta?.successUrl as string | null;

    // PENDING or FAILED — portal keeps polling or shows error
    if (tx.momoStatus !== "SUCCESSFUL") {
      return c.json({
        status: tx.momoStatus,
        referenceId,
      });
    }

    // SUCCESSFUL — return the success URL so the portal can redirect
    return c.json({
      status: "SUCCESSFUL",
      referenceId,
      credits: tx.credits,
      ugxPaid: tx.ugxAmount,
      balanceAfter: tx.balanceAfter,
      // Portal reads this and does: window.location.href = redirectUrl
      redirectUrl: successUrl
        ? `${successUrl}?ref=${referenceId}&credits=${tx.credits}&status=success`
        : null,
    });
  })
  // Add to packages/server/src/routes/billing.ts

  .get("/upgrade", async (c) => {
    // Optional: resolve client to personalise the response
    const apiKey = c.req.header("X-Platform-Key") ?? c.req.query("key"); // allow as query param for browser links

    const client = apiKey
      ? await db.apiClient.findUnique({
          where: { apiKey },
          select: { name: true, creditBalance: true },
        })
      : null;

    const returnUrl = c.req.query("returnUrl"); // where to send the user after top-up

    return c.json({
      ...(client && { client: client.name, balance: client.creditBalance }),
      ugxPerCredit: UGX_PER_CREDIT,
      bundles: CREDIT_BUNDLES.map((b) => ({
        id: b.id,
        credits: b.credits,
        ugx: b.ugx,
        discountPct: b.discountPct,
        label: `UGX ${b.ugx.toLocaleString()} — ${b.credits.toLocaleString()} credits`,
        topUpUrl: returnUrl
          ? `/billing/topup?bundle=${b.id}&returnUrl=${encodeURIComponent(returnUrl)}`
          : `/billing/topup?bundle=${b.id}`,
      })),
      momoInstructions: [
        "Select a bundle above",
        "Enter your MTN MoMo number when prompted",
        "Approve the prompt on your handset",
        "Credits are added to your balance immediately on confirmation",
      ],
    });
  })

  // ── GET /billing/usage — paginated usage history ────────────────────────────
  .get("/usage", async (c) => {
    const apiKey = requireApiKey(c);
    if (!apiKey) return c.json({ error: "API key required" }, 401);

    const client = await db.apiClient.findUnique({
      where: { apiKey },
      select: { id: true },
    });
    if (!client) return c.json({ error: "Invalid API key" }, 401);

    const page = Math.max(1, Number(c.req.query("page") ?? 1));
    const limit = Math.min(100, Number(c.req.query("limit") ?? 20));

    const [records, total] = await Promise.all([
      db.usageRecord.findMany({
        where: { clientId: client.id },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          model: true,
          provider: true,
          promptTokens: true,
          completionTokens: true,
          totalTokens: true,
          creditsUsed: true,
          generationType: true,
          durationMs: true,
          createdAt: true,
        },
      }),
      db.usageRecord.count({ where: { clientId: client.id } }),
    ]);

    return c.json({ records, total, page, pages: Math.ceil(total / limit) });
  });

export default app;
