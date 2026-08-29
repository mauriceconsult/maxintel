import { Hono, type Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "@maxintel/database";
import { getClientBalance } from "../lib/credits";
import { authenticateOAuthRequest } from "../lib/auth";
import { ensureBillingAccount } from "../billing/chat-billing";
import { CREDIT_BUNDLES, UGX_PER_CREDIT } from "../lib/pricing";
import { initiateTopUp, processTopUpWebhook, reconcileTopUp } from "../lib/momo";
import {
  buildCheckoutUrl,
  verifyCheckoutToken,
  publicBaseUrl,
} from "../lib/checkout-token";
import { renderCheckoutPage, renderExpiredPage } from "../lib/checkout-page";
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

// ── Caller resolution ─────────────────────────────────────────────────────────
// Billing is reached three different ways and each carries a different
// credential:
//   • platform apps  → an ApiClient.apiKey
//   • the CLI        → a Clerk OAuth token (its ApiClient is keyed by userId)
//   • the browser    → a signed checkout token, which is never an API key
// Resolving all three in one place is what lets a single set of endpoints serve
// every surface.

type Caller = {
  clientId: string;
  name: string;
  balance: number;
  /** Return URL signed into a checkout token, when that is the credential */
  returnUrl: string | null;
};

const CLIENT_FIELDS = {
  id: true,
  name: true,
  creditBalance: true,
  isActive: true,
} as const;

async function resolveCaller(c: Context): Promise<Caller | null> {
  const toCaller = (
    client: {
      id: string;
      name: string;
      creditBalance: number;
      isActive: boolean;
    } | null,
    returnUrl: string | null,
  ): Caller | null =>
    client?.isActive
      ? {
          clientId: client.id,
          name: client.name,
          balance: client.creditBalance,
          returnUrl,
        }
      : null;

  // 1. Signed checkout token (browser page)
  const checkout = verifyCheckoutToken(c.req.header("X-Checkout-Token"));
  if (checkout) {
    return toCaller(
      await db.apiClient.findUnique({
        where: { id: checkout.cid },
        select: CLIENT_FIELDS,
      }),
      checkout.ret ?? null,
    );
  }

  const bearer = requireApiKey(c);
  if (!bearer) return null;

  // 2. Platform API key
  const byKey = await db.apiClient.findUnique({
    where: { apiKey: bearer },
    select: CLIENT_FIELDS,
  });
  if (byKey) return toCaller(byKey, null);

  // 3. Clerk OAuth token (the CLI). The account is created lazily on first
  //    generation, so a user who has never generated has nothing to find yet —
  //    ensureBillingAccount gives them a zero-balance account to top up.
  const auth = await authenticateOAuthRequest(c.req.raw).catch(() => null);
  if (!auth) return null;

  const account = await ensureBillingAccount(auth.userId);
  return toCaller(account, null);
}

const topUpSchema = z.object({
  bundleId: z.enum(["starter", "growth", "scale", "enterprise"]),
  phone: z.string().min(9),
  successUrl: z.url().optional(), // ← portal passes its own return URL
});

const checkoutSessionSchema = z.object({
  returnUrl: z.url().optional(),
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
    const caller = await resolveCaller(c);
    if (!caller) return c.json({ error: "Authentication required" }, 401);

    const summary = await getClientBalance(caller.clientId);
    return c.json({ client: caller.name, ...summary });
  })

  // ── POST /billing/checkout/session — mint a browser checkout link ──────────
  // Hands back a short-lived signed URL that is safe to open in a browser,
  // print in a terminal or send to a phone.
  .post(
    "/checkout/session",
    zValidator("json", checkoutSessionSchema),
    async (c) => {
      const caller = await resolveCaller(c);
      if (!caller) return c.json({ error: "Authentication required" }, 401);

      const { returnUrl } = c.req.valid("json");

      return c.json({
        checkoutUrl: buildCheckoutUrl({
          clientId: caller.clientId,
          returnUrl,
        }),
        expiresInSeconds: 30 * 60,
        client: caller.name,
        balance: caller.balance,
      });
    },
  )

  // ── GET /billing/checkout — the browser top-up page ────────────────────────
  // Public by design: the signed `t` token is the credential. No API key ever
  // touches the URL bar, browser history or referrer headers.
  .get("/checkout", async (c) => {
    const payload = verifyCheckoutToken(c.req.query("t"));

    if (!payload) {
      return c.html(
        renderExpiredPage(
          "The link is missing, expired or has already been superseded.",
        ),
        410,
      );
    }

    const client = await db.apiClient.findUnique({
      where: { id: payload.cid },
      select: { name: true, creditBalance: true, isActive: true },
    });

    if (!client?.isActive) {
      return c.html(
        renderExpiredPage("This billing account is no longer active."),
        403,
      );
    }

    // `required` / `model` let the page explain *why* the user is here when the
    // link came from a 402; both are optional.
    const requiredParam = Number(c.req.query("required"));
    const required = Number.isFinite(requiredParam) && requiredParam > 0
      ? requiredParam
      : null;

    return c.html(
      renderCheckoutPage({
        token: c.req.query("t") ?? "",
        clientName: client.name,
        balance: client.creditBalance,
        required,
        model: c.req.query("model") ?? null,
        returnUrl: payload.ret ?? null,
        bundles: CREDIT_BUNDLES.map((b) => ({
          id: b.id,
          credits: b.credits,
          ugx: b.ugx,
          discountPct: b.discountPct,
        })),
        ugxPerCredit: UGX_PER_CREDIT,
        phonePlaceholder: process.env.MOMO_PHONE_PLACEHOLDER ?? "0772 123 456",
      }),
    );
  })

  // ── POST /billing/topup — initiate MoMo top-up ─────────────────────────────
  // Accepts either an API key or a checkout token (browser page).
  .post("/topup", zValidator("json", topUpSchema), async (c) => {
    const caller = await resolveCaller(c);
    if (!caller)
      return c.json({ error: "Invalid or inactive client" }, 401);

    const { bundleId, phone, successUrl } = c.req.valid("json");

    // A browser-supplied successUrl would be an open redirect on the status
    // endpoint, so a token-authenticated caller always uses the URL that was
    // signed into its token.
    const returnUrl = caller.returnUrl ?? successUrl;

    try {
      const { referenceId, bundle } = await initiateTopUp({
        clientId: caller.clientId,
        bundleId,
        phone,
        successUrl: returnUrl,
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
      const body = JSON.parse(raw) as {
        referenceId?: string;
        externalId?: string;
        status?: string;
      };

      // MTN's callback body does not always echo referenceId — it is the
      // X-Reference-Id we sent, which MTN mirrors back on this header.
      const referenceId =
        body.referenceId ?? c.req.header("X-Reference-Id") ?? null;

      if (referenceId && body.status) {
        await processTopUpWebhook(referenceId, body.status);
      } else {
        console.warn("[billing/webhook] Unusable callback payload:", raw);
      }
    } catch (err) {
      console.error("[billing/webhook]", err);
    }
    // Always acknowledge to MTN — prevents retry storms
    return c.json({ received: true });
  })

  // GET /billing/status/:referenceId
  // The checkout page (and any portal) polls this every 3–5 seconds while
  // showing "waiting for approval". When the record is still PENDING we ask MTN
  // directly rather than trusting the callback to arrive — callbacks cannot
  // reach a dev machine at all, and are best-effort in production.
  .get("/status/:referenceId", async (c) => {
    const { referenceId } = c.req.param();

    let tx = await db.creditTransaction.findUnique({
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

    if (tx.momoStatus === "PENDING") {
      const settlement = await reconcileTopUp(referenceId);
      if (settlement) {
        tx = await db.creditTransaction.findUnique({
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
      }
    }

    const meta = tx.metadata as Record<string, unknown> | null;
    const successUrl = (meta?.successUrl as string | null) ?? null;

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

  // ── GET /billing/upgrade — machine-readable upgrade info ───────────────────
  // Returns the browser checkout link alongside the bundle list, so a caller
  // can either render its own UI or just open `checkoutUrl`.
  .get("/upgrade", async (c) => {
    const caller = await resolveCaller(c);
    const returnUrl = c.req.query("returnUrl") ?? null;

    return c.json({
      ...(caller && { client: caller.name, balance: caller.balance }),
      ugxPerCredit: UGX_PER_CREDIT,
      // Only a resolved, active client can be issued a checkout link — an
      // anonymous caller gets the pricing table and nothing more.
      checkoutUrl: caller
        ? buildCheckoutUrl({ clientId: caller.clientId, returnUrl })
        : null,
      bundles: CREDIT_BUNDLES.map((b) => ({
        id: b.id,
        credits: b.credits,
        ugx: b.ugx,
        discountPct: b.discountPct,
        label: `UGX ${b.ugx.toLocaleString()} — ${b.credits.toLocaleString()} credits`,
      })),
      momoInstructions: [
        "Open the checkout link in a browser",
        "Pick a bundle and enter your MTN MoMo number",
        "Approve the prompt on your handset",
        "Credits are added to your balance immediately on confirmation",
      ],
      portalUrl: `${publicBaseUrl()}/billing/checkout`,
    });
  })

  // ── GET /billing/usage — paginated usage history ────────────────────────────
  .get("/usage", async (c) => {
    const caller = await resolveCaller(c);
    if (!caller) return c.json({ error: "Authentication required" }, 401);

    const client = { id: caller.clientId };

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
