import { db } from "@maxintel/database";
import { buildUpgradeResponse } from "../middleware/billing";
import type { SupportedChatModelId } from "@maxintel/shared";
import { checkCredits } from "../lib/credits";
import { TransactionType } from "@maxintel/database";
import { findSupportedChatModel } from "@maxintel/shared";
import { MODEL_CREDIT_COST } from "../lib/pricing";

// ── Upsert billing account for a Clerk user ───────────────────────────────────
// Called on every chat request — idempotent, cheap after first creation.
export async function ensureBillingAccount(userId: string) {
  return db.apiClient.upsert({
    where: { userId }, // now valid: userId is @unique
    create: {
      userId,
      name: `Maxintel user ${userId.slice(0, 12)}`,
      apiKey: `mx_user_${crypto.randomUUID()}`,
      creditBalance: 0,
      isActive: true,
    },
    update: {}, // already exists — touch nothing
  });
}

// ── Find billing account for a user ──────────────────────────────────────────
export async function findApiClientForUser(userId: string) {
  return db.apiClient.findUnique({
    where: { userId },
    select: {
      id: true,
      name: true,
      creditBalance: true,
      isActive: true,
      monthlySpendCap: true,
    },
  });
}

// ── Assert sufficient credits — auto-creates account if missing ───────────────
export type CreditAssertResult =
  | { ok: true; clientId: string; estimatedCost: number }
  | {
      ok: false;
      status: 402 | 403;
      body: ReturnType<typeof buildUpgradeResponse>;
    };

export async function assertSufficientCredits({
  userId,
  modelId,
  maxTokens,
}: {
  userId: string;
  modelId: SupportedChatModelId;
  maxTokens?: number;
}): Promise<CreditAssertResult> {
  // Auto-create rather than fail — first-time CLI users get a 0-balance
  // account immediately; the upgrade nudge tells them how to top up.
  const client = await ensureBillingAccount(userId);

  if (!client.isActive) {
    return {
      ok: false,
      status: 403,
      body: buildUpgradeResponse(client, client.creditBalance, null),
    };
  }

  // Delegate to the shared credit checker (handles zero balance, monthly cap)
  const check = await checkCredits(client.apiKey, modelId, maxTokens);

  if (!check.ok) {
    return {
      ok: false,
      status: 402,
      body: buildUpgradeResponse(
        client,
        check.balance,
        check.required,
        modelId,
      ),
    };
  }

  return { ok: true, clientId: client.id, estimatedCost: check.estimatedCost };
}

// ── Record and charge chat usage ─────────────────────────────────────────────
// Charges only after generation succeeds.
// Idempotent by requestId so retries cannot double-charge.

export async function recordChatUsage(input: {
  userId: string;
  clientId: string;
  requestId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  durationMs?: number;
  generationType?: string;
}) {
  const meta = findSupportedChatModel(input.model);
  const provider = meta?.provider ?? "unknown";

  const per1k =
    MODEL_CREDIT_COST[input.model as SupportedChatModelId] ?? 1;

  const totalTokens = input.promptTokens + input.completionTokens;

  const creditsUsed = Math.max(
    1,
    Math.ceil(totalTokens / 1000) * per1k,
  );

  return db.$transaction(async (tx) => {
    // Prevent duplicate charges when the same request is retried.
    const existing = await tx.usageRecord.findUnique({
      where: { requestId: input.requestId },
    });

    if (existing) {
      return {
        creditsUsed: existing.creditsUsed,
        balanceAfter: null,
        duplicate: true,
      };
    }

    const client = await tx.apiClient.findUniqueOrThrow({
      where: { id: input.clientId },
    });

    if (!client.isActive) {
      throw new Error("Billing account is inactive");
    }

    if (client.creditBalance < creditsUsed) {
      throw new Error("Insufficient credits");
    }

    const balanceAfter = client.creditBalance - creditsUsed;

    await tx.apiClient.update({
      where: { id: input.clientId },
      data: {
        creditBalance: balanceAfter,
      },
    });

    const transaction = await tx.creditTransaction.create({
      data: {
        clientId: input.clientId,
        type: TransactionType.USAGE,
        credits: -creditsUsed,
        description: `Chat usage ${input.model}`,
        metadata: {
          userId: input.userId,
          model: input.model,
          provider,
          promptTokens: input.promptTokens,
          completionTokens: input.completionTokens,
          totalTokens,
          generationType: input.generationType ?? "chat",
        },
        balanceAfter,
      },
    });

    await tx.usageRecord.create({
      data: {
        clientId: input.clientId,
        transactionId: transaction.id,
        requestId: input.requestId,
        model: input.model,
        provider,
        generationType: input.generationType ?? "chat",
        promptTokens: input.promptTokens,
        completionTokens: input.completionTokens,
        totalTokens,
        creditsUsed,
        durationMs: input.durationMs,
      },
    });

    return {
      creditsUsed,
      balanceAfter,
      duplicate: false,
    };
  });
}
