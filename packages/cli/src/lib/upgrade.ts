// import open from "open";

const API_URL = (
  process.env.API_URL ?? "https://maxintel.maxnovate.com"
).replace(/\/$/, "");

const PLATFORM_API_KEY =
  process.env.PLATFORM_API_KEY ?? process.env.MAXINTEL_API_KEY ?? "";

function billingHeaders(): Record<string, string> {
  if (!PLATFORM_API_KEY) return {};
  return {
    "X-Platform-Key": PLATFORM_API_KEY,
    Authorization: `Bearer ${PLATFORM_API_KEY}`,
  };
}

async function billingFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...billingHeaders(),
      ...(init?.headers ?? {}),
    },
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      typeof body === "object" &&
      body &&
      "error" in body &&
      typeof (body as { error: unknown }).error === "string"
        ? (body as { error: string }).error
        : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body;
}

export type UpgradeSummary = {
  client?: string;
  balance?: number;
  bundles: {
    id: string;
    credits: number;
    ugx: number;
    label?: string;
    discountPct?: number;
  }[];
  portalUrl: string;
};

/** Load upgrade payload and open the billing portal in the browser. */
// packages/cli/src/lib/api.ts  (wherever openUpgradePortal lives)

import { apiClient } from "./api-client";
import { getAuth } from "./auth";

export async function openUpgradePortal() {
  // Typed RPC call — resolves to GET http://localhost:3000/billing/upgrade
  const res = await apiClient.billing.upgrade.$get(
    {},
    {
      // Pass auth header so the endpoint can personalise the response
      // (shows client name + current balance)
      init: {
        headers: ((): Record<string, string> => {
          const auth = getAuth();
          return auth ? { "X-Platform-Key": auth.token } : {};
        })(),
      },
    },
  );

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `Upgrade portal returned ${res.status}`);
  }

  return res.json() as Promise<{
    client?: string;
    balance?: number;
    bundles: Array<{
      id: string;
      credits: number;
      ugx: number;
      discountPct: number;
      label: string;
      topUpUrl: string;
    }>;
    momoInstructions: string[];
  }>;
}

/** Optional: show balance without opening the browser. */
export async function getCreditBalance(): Promise<{
  client: string;
  balance: number;
}> {
  const data = (await billingFetch("/billing/balance")) as {
    client: string;
    creditBalance?: number;
    balance?: number;
  };

  return {
    client: data.client,
    balance: data.creditBalance ?? data.balance ?? 0,
  };
}
