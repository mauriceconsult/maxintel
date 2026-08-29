import open from "open";
import { apiClient } from "./api-client";

export type CheckoutSession = {
  checkoutUrl: string;
  expiresInSeconds: number;
  client: string;
  balance: number;
};

export type UpgradeSummary = {
  client?: string;
  balance?: number;
  checkoutUrl: string | null;
  bundles: {
    id: string;
    credits: number;
    ugx: number;
    discountPct: number;
    label: string;
  }[];
  momoInstructions: string[];
  portalUrl: string;
};

// Hono's typed RPC responses are not structurally `Response`, so this takes
// only the part it actually reads.
async function readError(
  res: { json: () => Promise<unknown> },
  fallback: string,
): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? fallback;
}

/**
 * Mint a browser checkout link and open it.
 *
 * The link is a signed, 30-minute token — no API key leaves the machine, so it
 * is safe to hand to a browser or read out over the phone. Returns the URL as
 * well, because `open` silently no-ops over SSH and in bare terminals; the
 * caller shows it so the user can copy it.
 */
export async function startMoMoTopUp(): Promise<CheckoutSession> {
  const res = await apiClient.billing.checkout.session.$post({ json: {} });

  if (!res.ok) {
    throw new Error(
      await readError(res, `Checkout session failed (${res.status})`),
    );
  }

  const session = (await res.json()) as CheckoutSession;
  void open(session.checkoutUrl).catch(() => {
    // No browser available — the caller prints the URL instead.
  });

  return session;
}

/** Bundle list + a checkout link, without opening anything. */
export async function getUpgradeOptions(): Promise<UpgradeSummary> {
  const res = await apiClient.billing.upgrade.$get({ query: {} });

  if (!res.ok) {
    throw new Error(
      await readError(res, `Upgrade portal returned ${res.status}`),
    );
  }

  return (await res.json()) as UpgradeSummary;
}

/** Show balance without opening the browser. */
export async function getCreditBalance(): Promise<{
  client: string;
  balance: number;
}> {
  const res = await apiClient.billing.balance.$get();

  if (!res.ok) {
    throw new Error(await readError(res, "Could not load balance"));
  }

  const data = (await res.json()) as { client: string; balance: number };
  return { client: data.client, balance: data.balance ?? 0 };
}

// ── Insufficient-credit (402) handling ────────────────────────────────────────
// The chat transport surfaces a failed response as an Error whose message is
// the raw response body. Left alone, a user hitting a 402 mid-conversation sees
// a wall of JSON. Parsing it back out lets the CLI show a sentence and open the
// MoMo checkout instead.

export type InsufficientCredits = {
  balance: number;
  required: number | null;
  shortfall: number | null;
  model: string | null;
  checkoutUrl: string;
  suggestedBundle: {
    id: string;
    credits: number;
    ugx: number;
    priceLabel: string;
  } | null;
};

export function parseInsufficientCredits(
  error: unknown,
): InsufficientCredits | null {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : null;

  if (!raw || !raw.includes("PAYMENT_REQUIRED")) return null;

  try {
    const body = JSON.parse(raw) as {
      code?: string;
      balance?: number;
      required?: number | null;
      shortfall?: number | null;
      model?: string | null;
      upgrade?: {
        checkoutUrl?: string;
        suggestedBundle?: InsufficientCredits["suggestedBundle"];
      };
    };

    if (body.code !== "PAYMENT_REQUIRED" || !body.upgrade?.checkoutUrl) {
      return null;
    }

    return {
      balance: body.balance ?? 0,
      required: body.required ?? null,
      shortfall: body.shortfall ?? null,
      model: body.model ?? null,
      checkoutUrl: body.upgrade.checkoutUrl,
      suggestedBundle: body.upgrade.suggestedBundle ?? null,
    };
  } catch {
    return null;
  }
}

/** Human-readable replacement for the raw 402 body. */
export function formatInsufficientCredits(info: InsufficientCredits): string {
  const need =
    info.required !== null
      ? `${info.required.toLocaleString()} credits needed, you have ${info.balance.toLocaleString()}`
      : `Your balance is ${info.balance.toLocaleString()} credits`;

  const bundle = info.suggestedBundle
    ? `Suggested: ${info.suggestedBundle.credits.toLocaleString()} credits for ${info.suggestedBundle.priceLabel}`
    : "Choose a bundle in the browser";

  return `Out of credits — ${need}.
${bundle}. Top up with MTN MoMo:
${info.checkoutUrl}`;
}

/** Open the MoMo checkout for a 402. Safe to call on any error. */
export function openCheckoutForError(error: unknown): InsufficientCredits | null {
  const info = parseInsufficientCredits(error);
  if (!info) return null;

  void open(info.checkoutUrl).catch(() => {
    // No browser — the formatted message still carries the URL.
  });

  return info;
}
