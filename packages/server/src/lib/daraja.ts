import { db, TransactionType } from "@maxintel/database";
import { findBundle } from "./pricing";
import { processTopUpSettlement } from "./momo";

type DarajaConfig = {
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
  shortcode: string;
  passkey: string;
  callbackUrl: string;
  transactionType: string;
  accountReference: string;
  kesPerUgx: number;
};

type DarajaResponse = {
  MerchantRequestID?: string;
  ResponseCode?: string;
  ResponseDescription?: string;
  CheckoutRequestID?: string;
  ResultCode?: string | number;
};

function getDarajaConfig(): DarajaConfig {
  const consumerKey = process.env.DARAJA_CONSUMER_KEY;
  const consumerSecret = process.env.DARAJA_CONSUMER_SECRET;
  const shortcode = process.env.DARAJA_SHORTCODE;
  const passkey = process.env.DARAJA_PASSKEY;
  const callbackUrl = process.env.DARAJA_CALLBACK_URL;
  const kesPerUgx = Number(process.env.DARAJA_KES_PER_UGX);

  if (
    !consumerKey ||
    !consumerSecret ||
    !shortcode ||
    !passkey ||
    !callbackUrl ||
    !Number.isFinite(kesPerUgx) ||
    kesPerUgx <= 0
  ) {
    throw new Error(
      "Daraja credentials, DARAJA_CALLBACK_URL, and a positive DARAJA_KES_PER_UGX are required",
    );
  }

  const environment = process.env.DARAJA_ENV ?? "sandbox";
  if (environment !== "sandbox" && environment !== "production") {
    throw new Error("DARAJA_ENV must be sandbox or production");
  }
  const baseUrl =
    process.env.DARAJA_BASE_URL ??
    (environment === "production"
      ? "https://api.safaricom.co.ke"
      : "https://sandbox.safaricom.co.ke");

  const base = new URL(baseUrl);
  if (base.protocol !== "https:") {
    throw new Error("Daraja API base URL must use HTTPS");
  }
  const callback = new URL(callbackUrl);
  if (callback.protocol !== "https:") {
    throw new Error("DARAJA_CALLBACK_URL must use HTTPS");
  }

  return {
    baseUrl: base.toString(),
    consumerKey,
    consumerSecret,
    shortcode,
    passkey,
    callbackUrl: callback.toString(),
    transactionType:
      process.env.DARAJA_TRANSACTION_TYPE ?? "CustomerPayBillOnline",
    accountReference: process.env.DARAJA_ACCOUNT_REFERENCE ?? "Maxintel",
    kesPerUgx,
  };
}

export function isDarajaConfigured(): boolean {
  const callbackUrl = process.env.DARAJA_CALLBACK_URL;
  const kesPerUgx = Number(process.env.DARAJA_KES_PER_UGX);
  const hasCredentials = Boolean(
    process.env.DARAJA_CONSUMER_KEY &&
      process.env.DARAJA_CONSUMER_SECRET &&
      process.env.DARAJA_SHORTCODE &&
      process.env.DARAJA_PASSKEY &&
      callbackUrl &&
      Number.isFinite(kesPerUgx) &&
      kesPerUgx > 0,
  );
  const environment = process.env.DARAJA_ENV ?? "sandbox";
  if (
    !hasCredentials ||
    !callbackUrl ||
    (environment !== "sandbox" && environment !== "production")
  ) {
    return false;
  }

  try {
    const baseUrl =
      process.env.DARAJA_BASE_URL ??
      (environment === "production"
        ? "https://api.safaricom.co.ke"
        : "https://sandbox.safaricom.co.ke");
    return (
      new URL(callbackUrl).protocol === "https:" &&
      new URL(baseUrl).protocol === "https:"
    );
  } catch {
    return false;
  }
}

export function darajaKesAmount(ugxAmount: number): number {
  const kesPerUgx = Number(process.env.DARAJA_KES_PER_UGX);
  if (!Number.isFinite(kesPerUgx) || kesPerUgx <= 0) {
    throw new Error("DARAJA_KES_PER_UGX must be a positive number");
  }
  return Math.ceil(ugxAmount * kesPerUgx);
}

export function normalizeKenyanMsisdn(input: string): string {
  let digits = input.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0") && digits.length === 10) {
    digits = `254${digits.slice(1)}`;
  } else if (digits.length === 9) {
    digits = `254${digits}`;
  }

  if (!/^254[17]\d{8}$/.test(digits)) {
    throw new Error("Enter a valid Kenyan Safaricom mobile number");
  }
  return digits;
}

let tokenCache: { value: string; expiresAt: number } | null = null;

async function getAccessToken(config: DarajaConfig): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.value;
  }

  const credentials = Buffer.from(
    `${config.consumerKey}:${config.consumerSecret}`,
  ).toString("base64");
  const url = new URL("/oauth/v1/generate", config.baseUrl);
  url.searchParams.set("grant_type", "client_credentials");

  const response = await fetch(url, {
    headers: { Authorization: `Basic ${credentials}` },
  });
  if (!response.ok) {
    throw new Error(`Daraja OAuth failed: ${response.status}`);
  }

  const body = (await response.json()) as {
    access_token: string;
    expires_in: string;
  };
  tokenCache = {
    value: body.access_token,
    expiresAt: Date.now() + Number(body.expires_in) * 1_000,
  };
  return body.access_token;
}

function currentTimestamp(): string {
  const kenyaOffsetMs = 3 * 60 * 60 * 1_000;
  return new Date(Date.now() + kenyaOffsetMs)
    .toISOString()
    .replace(/\D/g, "")
    .slice(0, 14);
}

async function postDaraja(
  config: DarajaConfig,
  path: string,
  payload: Record<string, unknown>,
): Promise<DarajaResponse> {
  const accessToken = await getAccessToken(config);
  const response = await fetch(new URL(path, config.baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Daraja request ${response.status}: ${body}`);
  }
  return (await response.json()) as DarajaResponse;
}

export async function initiateDarajaTopUp({
  clientId,
  bundleId,
  phone,
  successUrl,
}: {
  clientId: string;
  bundleId: string;
  phone: string;
  successUrl?: string;
}) {
  const bundle = findBundle(bundleId);
  if (!bundle) throw new Error(`Unknown bundle: ${bundleId}`);

  const config = getDarajaConfig();
  const msisdn = normalizeKenyanMsisdn(phone);
  const timestamp = currentTimestamp();
  const amountKes = darajaKesAmount(bundle.ugx);
  const password = Buffer.from(
    `${config.shortcode}${config.passkey}${timestamp}`,
  ).toString("base64");
  const response = await postDaraja(config, "/mpesa/stkpush/v1/processrequest", {
    BusinessShortCode: config.shortcode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: config.transactionType,
    Amount: amountKes,
    PartyA: msisdn,
    PartyB: config.shortcode,
    PhoneNumber: msisdn,
    CallBackURL: config.callbackUrl,
    AccountReference: config.accountReference,
    TransactionDesc: `Credit top-up ${bundle.id}`,
  });

  if (response.ResponseCode !== "0" || !response.CheckoutRequestID) {
    throw new Error(
      `Daraja STK Push failed: ${response.ResponseDescription ?? "invalid response"}`,
    );
  }

  const referenceId = response.CheckoutRequestID;
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
        successUrl: successUrl ?? null,
        paymentProvider: "daraja",
        paidAmountKes: amountKes,
        kesPerUgx: config.kesPerUgx,
        merchantRequestId: response.MerchantRequestID ?? null,
        msisdn,
      },
      balanceAfter: 0,
    },
  });

  return { referenceId, bundle, amountKes };
}

const terminalFailureCodes = new Set(["1", "1032", "1037", "2001", "2006", "2007"]);

export async function reconcileDarajaTopUp(
  referenceId: string,
): Promise<Awaited<ReturnType<typeof processTopUpSettlement>> | null> {
  try {
    const config = getDarajaConfig();
    const timestamp = currentTimestamp();
    const password = Buffer.from(
      `${config.shortcode}${config.passkey}${timestamp}`,
    ).toString("base64");
    const response = await postDaraja(config, "/mpesa/stkpushquery/v1/query", {
      BusinessShortCode: config.shortcode,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: referenceId,
    });

    if (response.ResultCode === undefined) return null;
    const resultCode = String(response.ResultCode);
    if (resultCode === "0") {
      return processTopUpSettlement(referenceId, "SUCCESSFUL");
    }
    if (terminalFailureCodes.has(resultCode)) {
      return processTopUpSettlement(referenceId, "FAILED");
    }
    return null;
  } catch (error) {
    console.warn("[billing/daraja] Status lookup failed:", referenceId, error);
    return null;
  }
}
