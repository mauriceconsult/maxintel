import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import {
  findSupportedChatModel,
  type SupportedChatModel,
  type SupportedChatModelId,
  type SupportedProvider,
} from "@maxintel/shared";
import type { LanguageModel } from "ai";

// ── Per-provider model ID types ───────────────────────────────────────────────
type ProviderModelId<P extends SupportedProvider> = Extract<
  SupportedChatModel,
  { provider: P }
>["id"];

type AnthropicModelId = ProviderModelId<"anthropic">;
type OpenAIModelId = ProviderModelId<"openai">;
type GoogleModelId = ProviderModelId<"google">;

// ── Return type ───────────────────────────────────────────────────────────────
export type ResolvedModel = {
  model: LanguageModel;
  provider: SupportedProvider;
  modelId: SupportedChatModelId;
};

// ── Exhaustiveness guard ──────────────────────────────────────────────────────
function assertUnsupportedProvider(provider: never): never {
  throw new Error(`Unsupported provider: ${provider}`);
}

// ── Per-provider resolvers ────────────────────────────────────────────────────
// Cast bridges the gap between our SupportedChatModel ID union and the SDK's
// own internal ID union — safe because findSupportedChatModel validates first.

function resolveAnthropicModel(modelId: AnthropicModelId): ResolvedModel {
  return {
    model: anthropic(modelId as Parameters<typeof anthropic>[0]),
    provider: "anthropic",
    modelId,
  };
}

function resolveOpenAIModel(modelId: OpenAIModelId): ResolvedModel {
  return {
    model: openai(modelId as Parameters<typeof openai>[0]),
    provider: "openai",
    modelId,
  };
}

function resolveGoogleModel(modelId: GoogleModelId): ResolvedModel {
  return {
    model: google(modelId as Parameters<typeof google>[0]),
    provider: "google",
    modelId,
  };
}

// ── Dispatcher ────────────────────────────────────────────────────────────────
function resolveSupportedChatModel(model: SupportedChatModel): ResolvedModel {
  switch (model.provider) {
    case "anthropic":
      return resolveAnthropicModel(model.id);
    case "openai":
      return resolveOpenAIModel(model.id);
    case "google":
      return resolveGoogleModel(model.id);
    default:
      return assertUnsupportedProvider(model as never);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────
export function isSupportedChatModel(
  modelId: string,
): modelId is SupportedChatModelId {
  return findSupportedChatModel(modelId) != null;
}

export function resolveChatModel(modelId: string): ResolvedModel {
  const model = findSupportedChatModel(modelId);
  if (!model) throw new Error(`Unsupported model: ${modelId}`);
  return resolveSupportedChatModel(model);
}
