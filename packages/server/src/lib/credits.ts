// Atomic credit operations — all balance mutations go through here.
// Uses DB-level transactions to prevent race conditions on concurrent requests.
// Pattern: check → reserve (pre-deduct) → generate → settle (exact amount).

import { db, type Prisma } from "@maxintel/database";
import { TransactionType } from "@maxintel/database/enums";
import type { SupportedChatModelId } from "@maxintel/shared";
import { calculateCreditsUsed, estimateCredits } from "./pricing";

// ── Client lookup ─────────────────────────────────────────────────────────────

export async function getClientByApiKey(apiKey: string) {
  return db.apiClient.findUnique({
    where: { apiKey },
    select: {
      id: true,
      name: true,
      creditBalance: true,
      isActive: true,
      monthlySpendCap: true,
    },
  });
}

// ── Credit check ──────────────────────────────────────────────────────────────

export type CreditCheckResult =
  | { ok: true; clientId: string; estimatedCost: number }
  | {
      ok: false;
      reason: "insufficient_credits" | "inactive_client" | "spend_cap_reached";
      balance: number;
      required: number;
    };

export async function checkCredits(
  apiKey: string,
  modelId: SupportedChatModelId,
  maxTokens?: number,
): Promise<CreditCheckResult> {
  const client = await getClientByApiKey(apiKey);

  if (!client || !client.isActive) {
    return { ok: false, reason: "inactive_client", balance: 0, required: 0 };
  }

  const estimated = estimateCredits(modelId, maxTokens);

  if (client.creditBalance < estimated) {
    return {
      ok: false,
      reason: "insufficient_credits",
      balance: client.creditBalance,
      required: estimated,
    };
  }

  // Monthly spend cap check — compare against this calendar month's usage
  if (client.monthlySpendCap) {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const monthlyUsed = await db.creditTransaction.aggregate({
      where: {
        clientId: client.id,
        type: TransactionType.USAGE,
        createdAt: { gte: startOfMonth },
      },
      _sum: { credits: true },
    });

    const usedThisMonth = Math.abs(monthlyUsed._sum.credits ?? 0);
    if (usedThisMonth + estimated > client.monthlySpendCap) {
      return {
        ok: false,
        reason: "spend_cap_reached",
        balance: client.creditBalance,
        required: estimated,
      };
    }
  }

  return { ok: true, clientId: client.id, estimatedCost: estimated };
}

// ── Credit deduction (post-generation, exact amount) ─────────────────────────

export async function deductCredits({
  clientId,
  requestId,
  model,
  provider,
  promptTokens,
  completionTokens,
  generationType,
  durationMs,
}: {
  clientId: string;
  requestId: string;
  model: SupportedChatModelId;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  generationType?: string;
  durationMs?: number;
}) {
  const totalTokens = promptTokens + completionTokens;
  const creditsUsed = calculateCreditsUsed(totalTokens, model);

  // Atomic: update balance + record transaction + record usage in one DB tx
  const [, transaction, usage] = await db.$transaction([
    db.apiClient.update({
      where: { id: clientId },
      data: { creditBalance: { decrement: creditsUsed } },
    }),

    db.creditTransaction.create({
      data: {
        clientId,
        type: TransactionType.USAGE,
        credits: -creditsUsed, // negative = consumed
        description: `Generation: ${model} — ${totalTokens.toLocaleString()} tokens`,
        metadata: {
          model,
          provider,
          promptTokens,
          completionTokens,
          totalTokens,
          generationType,
        },
        balanceAfter: 0, // updated below after read
      },
    }),

    db.usageRecord.create({
      data: {
        clientId,
        requestId,
        model,
        provider,
        generationType,
        promptTokens,
        completionTokens,
        totalTokens,
        creditsUsed,
        durationMs,
      },
    }),
  ]);

  // Snapshot the balance after deduction — needed for balance history
  const { creditBalance } = await db.apiClient.findUniqueOrThrow({
    where: { id: clientId },
    select: { creditBalance: true },
  });

  await db.creditTransaction.update({
    where: { id: transaction.id },
    data: { balanceAfter: creditBalance, transactionId: usage.id },
  });

  return { creditsUsed, balanceAfter: creditBalance };
}

// ── Credit addition (topup / bonus / refund) ──────────────────────────────────

export async function addCredits({
  clientId,
  type,
  credits,
  ugxAmount,
  momoRef,
  momoStatus,
  description,
  metadata,
}: {
  clientId: string;
  type: TransactionType;
  credits: number;
  ugxAmount?: number;
  momoRef?: string;
  momoStatus?: string;
  description: string;
  metadata?: Record<string, unknown>;
}) {
  const [updatedClient, transaction] = await db.$transaction([
    db.apiClient.update({
      where: { id: clientId },
      data: { creditBalance: { increment: credits } },
    }),
    db.creditTransaction.create({
      data: {
        clientId,
        type,
        credits,
        ugxAmount,
        momoRef,
        momoStatus,
        description,
        metadata: metadata as Prisma.InputJsonValue | undefined,
        balanceAfter: 0, // updated below
      },
    }),
  ]);

  await db.creditTransaction.update({
    where: { id: transaction.id },
    data: { balanceAfter: updatedClient.creditBalance },
  });

  return { balanceAfter: updatedClient.creditBalance };
}

// ── Balance summary ────────────────────────────────────────────────────────────

export async function getClientBalance(clientId: string) {
  const [client, usage30d] = await Promise.all([
    db.apiClient.findUnique({
      where: { id: clientId },
      select: { creditBalance: true, monthlySpendCap: true },
    }),
    db.usageRecord.aggregate({
      where: {
        clientId,
        createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
      _sum: { creditsUsed: true, totalTokens: true },
      _count: { id: true },
    }),
  ]);

  return {
    balance: client?.creditBalance ?? 0,
    monthlySpendCap: client?.monthlySpendCap ?? null,
    last30Days: {
      creditsUsed: usage30d._sum.creditsUsed ?? 0,
      totalTokens: usage30d._sum.totalTokens ?? 0,
      requestCount: usage30d._count.id,
    },
  };
}
