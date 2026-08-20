// Industry benchmark: tier-based credit cost per model, prepaid wallet.
// Source: ElevenLabs (0.5–1 credit/char by model), Anthropic (exchange rate
// varies by model), OpenAI (token-metered). Maxintel mirrors this pattern
// with UGX-denominated bundles for MoMo-first Ugandan market.
//
// 1 credit = UGX 5
// Credit cost varies per model tier — cheapest default routes to Flash Lite.

import type { SupportedChatModelId } from "@maxintel/shared";

export const UGX_PER_CREDIT = 5;
export const TOKENS_PER_CREDIT_UNIT = 1_000; // credits charged per 1K tokens

// Model credit cost per 1K tokens consumed (input + output combined).
// Higher tiers reflect provider cost differential — same pricing transparency
// as Anthropic's published per-model rates.
export const MODEL_CREDIT_COST: Record<SupportedChatModelId, number> = {
  // Google — cheapest tier
  "gemini-2.5-flash-lite": 1, // ~UGX 5 / 1K
  "gemini-2.5-flash": 4, // ~UGX 20 / 1K
  "gemini-2.5-pro": 10, // ~UGX 50 / 1K

  // OpenAI
  "gpt-5.6-luna": 2, // ~UGX 10 / 1K
  "gpt-5.6-terra": 8, // ~UGX 40 / 1K
  "gpt-5.6-sol": 40, // ~UGX 200 / 1K

  // DeepSeek
  "deepseek-chat": 2, // ~UGX 10 / 1K
  "deepseek-reasoner": 5, // ~UGX 25 / 1K

  // xAI
  "grok-4.5": 8, // ~UGX 40 / 1K

  // Anthropic
  "claude-haiku-4-5": 6, // ~UGX 30 / 1K
  "claude-sonnet-4-6": 15, // ~UGX 75 / 1K
  "claude-opus-4-6": 70, // ~UGX 350 / 1K
};

// Volume-discounted bundles — industry standard is 10–30% discount at scale.
// OpenAI gives none; ElevenLabs offers rollover. Maxintel offers discount + rollover.
export const CREDIT_BUNDLES = [
  { id: "starter", credits: 1_000, ugx: 5_000, discountPct: 0 },
  { id: "growth", credits: 5_000, ugx: 22_500, discountPct: 10 },
  { id: "scale", credits: 25_000, ugx: 100_000, discountPct: 20 },
  { id: "enterprise", credits: 100_000, ugx: 350_000, discountPct: 30 },
] as const;

export type BundleId = (typeof CREDIT_BUNDLES)[number]["id"];

export function findBundle(id: string) {
  return CREDIT_BUNDLES.find((b) => b.id === id);
}

/**
 * Calculate credits consumed for a generation.
 * Uses ceiling division — partial 1K-token blocks round up, same as OpenAI.
 */
export function calculateCreditsUsed(
  totalTokens: number,
  modelId: SupportedChatModelId,
): number {
  const costPerKTokens = MODEL_CREDIT_COST[modelId];
  const kTokens = Math.ceil(totalTokens / TOKENS_PER_CREDIT_UNIT);
  return kTokens * costPerKTokens;
}

/**
 * Estimated credits for a request before generation.
 * Used to pre-check balance. Assumes a conservative 2K output tokens.
 */
export function estimateCredits(
  modelId: SupportedChatModelId,
  maxTokens = 2_000,
): number {
  return calculateCreditsUsed(maxTokens, modelId);
}
