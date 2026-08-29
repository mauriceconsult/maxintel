// Short-lived, HMAC-signed tokens that let a browser complete a MoMo top-up
// without ever putting a platform API key in a URL (history, logs, referrers).
//
// Format: <base64url(payload)>.<base64url(hmac-sha256)>
// The payload is readable but not forgeable — it only names the client and
// where to send the user afterwards, never a credential.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_TTL_SECONDS = 30 * 60; // 30 minutes — long enough to find a handset

export type CheckoutTokenPayload = {
  /** ApiClient.id the top-up credits */
  cid: string;
  /** Where to send the browser after a confirmed payment */
  ret?: string;
  /** Unix seconds */
  exp: number;
};

// Falling back to a per-process random secret is deliberate: without a
// configured secret, tokens simply stop verifying after a restart. That fails
// closed (links expire early) rather than open (anyone can mint a token).
let _fallbackSecret: string | null = null;

function secret(): string {
  const configured = process.env.CHECKOUT_TOKEN_SECRET;
  if (configured) return configured;

  if (!_fallbackSecret) {
    _fallbackSecret = randomBytes(32).toString("hex");
    console.warn(
      "[billing/checkout] CHECKOUT_TOKEN_SECRET not set — using an ephemeral " +
        "secret. Checkout links will stop working after a restart or on a " +
        "second serverless instance. Set CHECKOUT_TOKEN_SECRET in production.",
    );
  }
  return _fallbackSecret;
}

function sign(data: string): string {
  return createHmac("sha256", secret()).update(data).digest("base64url");
}

export function signCheckoutToken({
  clientId,
  returnUrl,
  ttlSeconds = TOKEN_TTL_SECONDS,
}: {
  clientId: string;
  returnUrl?: string | null;
  ttlSeconds?: number;
}): string {
  const payload: CheckoutTokenPayload = {
    cid: clientId,
    exp: Math.floor(Date.now() / 1_000) + ttlSeconds,
    ...(returnUrl ? { ret: returnUrl } : {}),
  };

  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function verifyCheckoutToken(
  token: string | undefined | null,
): CheckoutTokenPayload | null {
  if (!token) return null;

  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;

  const expected = Buffer.from(sign(encoded));
  const provided = Buffer.from(signature);

  // Length check first — timingSafeEqual throws on a length mismatch
  if (expected.length !== provided.length) return null;
  if (!timingSafeEqual(expected, provided)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as CheckoutTokenPayload;

    if (!payload.cid || typeof payload.exp !== "number") return null;
    if (payload.exp * 1_000 < Date.now()) return null;

    return payload;
  } catch {
    return null;
  }
}

// ── Public URL of this deployment ─────────────────────────────────────────────
// Used to build absolute checkout links that get handed to a browser or shown
// in a terminal, where a relative path is useless.
export function publicBaseUrl(): string {
  const configured =
    process.env.PUBLIC_BASE_URL ??
    process.env.MOMO_CALLBACK_HOST ??
    "https://maxintel.maxnovate.com";
  return configured.replace(/\/$/, "");
}

export function buildCheckoutUrl({
  clientId,
  returnUrl,
  required,
  model,
}: {
  clientId: string;
  returnUrl?: string | null;
  /** Credits the blocked request needed — lets the page pre-select a bundle */
  required?: number | null;
  /** Model that triggered the 402, shown for context */
  model?: string | null;
}): string {
  const token = signCheckoutToken({ clientId, returnUrl });
  const params = new URLSearchParams({ t: token });

  // Display-only hints. They are unsigned on purpose: the worst a tampered
  // value can do is pre-select a different bundle, which the user then sees.
  if (required && required > 0) params.set("required", String(required));
  if (model) params.set("model", model);

  return `${publicBaseUrl()}/billing/checkout?${params.toString()}`;
}
