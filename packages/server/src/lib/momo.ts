import { db } from "@maxintel/database";
import { TransactionType } from "@maxintel/database";
import { addCredits } from "./credits";
import { findBundle } from "./pricing";


// ── Token cache ───────────────────────────────────────────────────────────────

let _token: { value: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (_token && _token.expiresAt > Date.now() + 60_000) return _token.value;

  const base = process.env.MOMO_TARGET_ENVIRONMENT!;
  const basic = Buffer.from(
    `${process.env.MOMOUSER_ID}:${process.env.MOMOUSER_SECRET}`,
  ).toString("base64");

  const res = await fetch(`${base}/collection/token/`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Ocp-Apim-Subscription-Key": process.env.MOMO_PRIMARY_KEY!,
    },
  });

  if (!res.ok) throw new Error(`MoMo token failed: ${res.status}`);
  const { access_token, expires_in } = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };

  _token = { value: access_token, expiresAt: Date.now() + expires_in * 1_000 };
  return access_token;
}

// ── Initiate a top-up payment ─────────────────────────────────────────────────
// packages/server/src/lib/billing/momo.ts

export async function initiateTopUp({
  clientId,
  bundleId,
  phone,
  successUrl, // ← portal passes this, stored on the pending transaction
}: {
  clientId: string;
  bundleId: string;
  phone: string;
  successUrl?: string;
}) {
  const bundle = findBundle(bundleId);
  if (!bundle) throw new Error(`Unknown bundle: ${bundleId}`);

  const referenceId = `MXI-TUP-${clientId.slice(0, 8).toUpperCase()}-${Date.now()}`;
  const token = await getToken();

  // The URL MTN will POST the payment result to.
  // Must be publicly reachable — localhost won't work in production.
  const callbackUrl = `${process.env.MOMO_CALLBACK_HOST}/billing/webhook`;

  const res = await fetch(
    `${process.env.MOMO_TARGET_ENVIRONMENT}/collection/v1_0/requesttopay`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Reference-Id": referenceId,
        "X-Target-Environment": process.env.MOMO_ENV ?? "sandbox",
        "Ocp-Apim-Subscription-Key": process.env.MOMO_PRIMARY_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: String(bundle.ugx),
        currency: "UGX",
        externalId: referenceId,
        payer: { partyIdType: "MSISDN", partyId: phone },
        payerMessage: `Maxintel ${bundle.id} — ${bundle.credits.toLocaleString()} credits`,
        payeeNote: `Maxintel credit top-up — bundle: ${bundle.id}`,
        callbackUrl, // ← was missing; MTN needs this to know where to POST
      }),
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`MoMo requestToPay ${res.status}: ${body}`);
  }

  // Persist with successUrl so the status endpoint can return it on confirmation
  await db.creditTransaction.create({
    data: {
      clientId,
      type: TransactionType.TOPUP,
      credits: bundle.credits,
      ugxAmount: bundle.ugx,
      momoRef: referenceId,
      momoStatus: "PENDING",
      description: `Top-up: ${bundle.id} bundle (${bundle.credits.toLocaleString()} credits)`,
      metadata: {
        bundleId: bundle.id,
        discountPct: bundle.discountPct,
        successUrl: successUrl ?? null, // ← stored here, returned on confirmation
        callbackUrl,
      },
      balanceAfter: 0,
    },
  });

  return { referenceId, bundle, callbackUrl };
}

// ── Process confirmed MoMo webhook ───────────────────────────────────────────

export async function processTopUpWebhook(
  referenceId: string,
  status: "SUCCESSFUL" | "FAILED" | string,
) {
  const pending = await db.creditTransaction.findUnique({
    where: { momoRef: referenceId },
    select: {
      id: true,
      clientId: true,
      credits: true,
      ugxAmount: true,
      momoStatus: true,
      metadata: true,
    },
  });

  if (!pending) {
    console.warn("[billing/momo] Unknown referenceId:", referenceId);
    return;
  }

  // Idempotency: already processed
  if (pending.momoStatus === "SUCCESSFUL") return;

  if (status !== "SUCCESSFUL") {
    await db.creditTransaction.update({
      where: { id: pending.id },
      data: { momoStatus: status },
    });
    console.warn("[billing/momo] Top-up failed:", referenceId, status);
    return;
  }

  // Credit the client — reuses the addCredits helper which handles the balance update
  const { balanceAfter } = await addCredits({
    clientId: pending.clientId,
    type: TransactionType.TOPUP,
    credits: pending.credits,
    ugxAmount: pending.ugxAmount ?? undefined,
    momoRef: `${referenceId}_confirmed`,
    momoStatus: "SUCCESSFUL",
    description: `Top-up confirmed (${pending.credits.toLocaleString()} credits)`,
    metadata: pending.metadata as Record<string, unknown> | undefined,
  });

  // Mark the pending record as SUCCESSFUL and record final balance
  await db.creditTransaction.update({
    where: { id: pending.id },
    data: { momoStatus: "SUCCESSFUL", balanceAfter },
  });

  console.log(
    `[billing/momo] Top-up confirmed: ${pending.credits} credits → client ${pending.clientId}, balance now ${balanceAfter}`,
  );
}
