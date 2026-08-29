import { db } from "@maxintel/database";
import { TransactionType } from "@maxintel/database";
import { findBundle } from "./pricing";

// ── MSISDN normalisation ──────────────────────────────────────────────────────
// Browser users type what they know: "0772 123 456", "+256772123456".
// MTN wants a bare international MSISDN with no plus and no spaces.

const COUNTRY_CODE = process.env.MOMO_COUNTRY_CODE ?? "256";

// The MTN sandbox only settles in EUR and rejects UGX outright with
// INVALID_CURRENCY, while the live mtnuganda environment wants UGX. Deriving
// this from MOMO_ENV means the sandbox works today and the production cutover
// is a single env change, not a code change. MOMO_CURRENCY overrides both
// (mtncongo, for instance, needs its own).
export const MOMO_CURRENCY =
  process.env.MOMO_CURRENCY ??
  ((process.env.MOMO_ENV ?? "sandbox") === "sandbox" ? "EUR" : "UGX");

// MTN rejects any non-ASCII byte in payerMessage / payeeNote with a bare 400
// and an empty body — an em dash in the note is enough to fail the payment.
// Both fields are also capped at 160 characters.
export function sanitizeNote(input: string): string {
  return input
    .replace(/[‒-―]/g, "-") // – — ― → -
    .replace(/[‘’]/g, "'") // curly single quotes
    .replace(/[“”]/g, '"') // curly double quotes
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7E]/g, "") // drop anything still non-ASCII
    .trim()
    .slice(0, 160);
}

export function normalizeMsisdn(input: string): string {
  let digits = input.replace(/\D/g, "");

  // "00256..." → "256..."
  if (digits.startsWith("00")) digits = digits.slice(2);

  // Local format "0772123456" → "256772123456"
  if (digits.startsWith("0")) digits = COUNTRY_CODE + digits.slice(1);

  // Bare subscriber number "772123456" → "256772123456"
  if (!digits.startsWith(COUNTRY_CODE) && digits.length === 9) {
    digits = COUNTRY_CODE + digits;
  }

  return digits;
}

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

export async function initiateTopUp({
  clientId,
  bundleId,
  phone,
  successUrl, // ← caller passes this, stored on the pending transaction
}: {
  clientId: string;
  bundleId: string;
  phone: string;
  successUrl?: string;
}) {
  const bundle = findBundle(bundleId);
  if (!bundle) throw new Error(`Unknown bundle: ${bundleId}`);

  // MTN validates X-Reference-Id as a UUID and rejects anything else, so the
  // readable "MXI-TUP-…" string goes in externalId (which is free-form) and the
  // UUID becomes our lookup key. A random UUID also means the unauthenticated
  // status endpoint cannot be walked by guessing references.
  const referenceId = crypto.randomUUID();
  const externalId = `MXI-TUP-${clientId.slice(0, 8).toUpperCase()}-${Date.now()}`;
  const msisdn = normalizeMsisdn(phone);
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
        currency: MOMO_CURRENCY,
        externalId,
        payer: { partyIdType: "MSISDN", partyId: msisdn },
        payerMessage: sanitizeNote(
          `Maxintel ${bundle.id}: ${bundle.credits.toLocaleString()} credits`,
        ),
        payeeNote: sanitizeNote(`Maxintel credit top-up, bundle ${bundle.id}`),
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
        externalId,
        msisdn,
      },
      balanceAfter: 0,
    },
  });

  return { referenceId, bundle, callbackUrl };
}

// ── Settle a top-up ──────────────────────────────────────────────────────────
// Single entry point for both the MTN webhook and the status poll, so a payment
// settles exactly once no matter which one observes it first.

export type TopUpSettlement = {
  status: string;
  credits: number;
  balanceAfter: number | null;
  settled: boolean;
};

export async function processTopUpWebhook(
  referenceId: string,
  status: "SUCCESSFUL" | "FAILED" | string,
): Promise<TopUpSettlement | null> {
  const pending = await db.creditTransaction.findUnique({
    where: { momoRef: referenceId },
    select: {
      id: true,
      clientId: true,
      credits: true,
      momoStatus: true,
      balanceAfter: true,
    },
  });

  if (!pending) {
    console.warn("[billing/momo] Unknown referenceId:", referenceId);
    return null;
  }

  // Terminal states are final — a duplicate webhook must never re-credit.
  if (pending.momoStatus === "SUCCESSFUL") {
    return {
      status: "SUCCESSFUL",
      credits: pending.credits,
      balanceAfter: pending.balanceAfter,
      settled: false,
    };
  }

  if (status !== "SUCCESSFUL") {
    await db.creditTransaction.update({
      where: { id: pending.id },
      data: { momoStatus: status },
    });
    console.warn("[billing/momo] Top-up not completed:", referenceId, status);
    return { status, credits: pending.credits, balanceAfter: null, settled: false };
  }

  // Credit the client and close out the pending row in one DB transaction.
  // The conditional updateMany is the idempotency guard: if a concurrent
  // webhook and status poll race, only one of them matches PENDING and the
  // other credits nothing.
  const balanceAfter = await db.$transaction(async (tx) => {
    const claimed = await tx.creditTransaction.updateMany({
      where: { id: pending.id, momoStatus: "PENDING" },
      data: { momoStatus: "SUCCESSFUL" },
    });

    if (claimed.count === 0) return null; // lost the race — already settled

    const client = await tx.apiClient.update({
      where: { id: pending.clientId },
      data: { creditBalance: { increment: pending.credits } },
      select: { creditBalance: true },
    });

    // The pending row becomes the settled TOPUP record — no second row, so the
    // transaction history shows one +credits entry per payment.
    await tx.creditTransaction.update({
      where: { id: pending.id },
      data: {
        balanceAfter: client.creditBalance,
        description: `Top-up confirmed (${pending.credits.toLocaleString()} credits)`,
      },
    });

    return client.creditBalance;
  });

  if (balanceAfter === null) {
    const settledRow = await db.creditTransaction.findUnique({
      where: { id: pending.id },
      select: { balanceAfter: true },
    });
    return {
      status: "SUCCESSFUL",
      credits: pending.credits,
      balanceAfter: settledRow?.balanceAfter ?? null,
      settled: false,
    };
  }

  console.log(
    `[billing/momo] Top-up confirmed: ${pending.credits} credits → client ${pending.clientId}, balance now ${balanceAfter}`,
  );

  return {
    status: "SUCCESSFUL",
    credits: pending.credits,
    balanceAfter,
    settled: true,
  };
}

// ── Ask MTN directly for a payment's status ──────────────────────────────────
// The browser checkout polls us, not MTN, and MTN's callback is best-effort
// (and unreachable at all from a local dev machine). Reconciling on demand is
// what makes the flow finish reliably; the webhook just makes it finish faster.

export async function reconcileTopUp(
  referenceId: string,
): Promise<TopUpSettlement | null> {
  let remoteStatus: string;

  try {
    const token = await getToken();
    const res = await fetch(
      `${process.env.MOMO_TARGET_ENVIRONMENT}/collection/v1_0/requesttopay/${referenceId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Target-Environment": process.env.MOMO_ENV ?? "sandbox",
          "Ocp-Apim-Subscription-Key": process.env.MOMO_PRIMARY_KEY!,
        },
      },
    );

    if (!res.ok) {
      console.warn("[billing/momo] Status lookup failed:", referenceId, res.status);
      return null;
    }

    const body = (await res.json()) as { status?: string };
    if (!body.status) return null;
    remoteStatus = body.status;
  } catch (err) {
    console.warn("[billing/momo] Status lookup errored:", referenceId, err);
    return null;
  }

  // Still awaiting the payer — nothing to write.
  if (remoteStatus === "PENDING") return null;

  return processTopUpWebhook(referenceId, remoteStatus);
}
