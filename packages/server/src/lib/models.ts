import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import { xai } from "@ai-sdk/xai";
import { deepseek } from "@ai-sdk/deepseek";
import {
  findSupportedChatModel,
  type SupportedChatModel,
  type SupportedChatModelId,
  type SupportedProvider,
} from "@maxintel/shared";
import type { LanguageModel, streamText } from "ai";

type ProviderOptions = NonNullable<
  Parameters<typeof streamText>[0]["providerOptions"]
>;

// ── Per-provider model ID types ───────────────────────────────────────────────
type ProviderModelId<P extends SupportedProvider> = Extract<
  SupportedChatModel,
  { provider: P }
>["id"];

type AnthropicModelId = ProviderModelId<"anthropic">;
type OpenAIModelId = ProviderModelId<"openai">;
type GoogleModelId = ProviderModelId<"google">;
type XaiModelId = ProviderModelId<"xai">;
type DeepSeekModelId = ProviderModelId<"deepseek">;

// ── Return type ───────────────────────────────────────────────────────────────
export type ResolvedModel = {
  model: LanguageModel;
  provider: SupportedProvider;
  modelId: SupportedChatModelId;
  providerOptions?: ProviderOptions;
};

const DEFAULT_REASONING_BUDGET = 10_000;

const ANTHROPIC_PROVIDER_OPTIONS: Partial<
  Record<AnthropicModelId, ProviderOptions>
> = {
  "claude-opus-4-6": {
    anthropic: {
      thinking: {
        type: "enabled",
        budgetTokens: DEFAULT_REASONING_BUDGET,
      },
    },
  },
  "claude-sonnet-4-6": {
    anthropic: {
      thinking: {
        type: "enabled",
        budgetTokens: DEFAULT_REASONING_BUDGET,
      },
    },
  },
  // Haiku: no extended thinking
};

const OPENAI_PROVIDER_OPTIONS: Partial<Record<OpenAIModelId, ProviderOptions>> =
  {
    "gpt-5.6-terra": {
      openai: {
        reasoning: {
          effort: "high",
          summary: "detailed",
        },
      },
    },
    "gpt-5.6-sol": {
      openai: {
        reasoning: {
          effort: "medium",
          summary: "detailed",
        },
      },
    },
    "gpt-5.6-luna": {
      openai: {
        reasoning: {
          effort: "low",
          summary: "detailed",
        },
      },
    },
  };

const GOOGLE_PROVIDER_OPTIONS: Partial<Record<GoogleModelId, ProviderOptions>> =
  {
    "gemini-2.5-pro": {
      google: {
        thinkingConfig: {
          thinkingBudget: 8192,
        },
      },
    },
    "gemini-2.5-flash": {
      google: {
        thinkingConfig: {
          thinkingBudget: 4096,
        },
      },
    },
    // Flash Lite intentionally omitted
  };

const XAI_PROVIDER_OPTIONS: Partial<Record<XaiModelId, ProviderOptions>> = {
  // add grok-specific options here when needed
};

const DEEPSEEK_PROVIDER_OPTIONS: Partial<
  Record<DeepSeekModelId, ProviderOptions>
> = {
  // reasoner may support provider-specific thinking flags later
};

// ── Exhaustiveness guard ──────────────────────────────────────────────────────
function assertUnsupportedProvider(model: never): never {
  throw new Error(
    `Unsupported chat model provider: ${(model as { provider: string }).provider}`,
  );
}

// ── Per-provider resolvers ────────────────────────────────────────────────────
function resolveAnthropicModel(modelId: AnthropicModelId): ResolvedModel {
  return {
    model: anthropic(modelId as Parameters<typeof anthropic>[0]),
    provider: "anthropic",
    modelId,
    providerOptions: ANTHROPIC_PROVIDER_OPTIONS[modelId],
  };
}

function resolveOpenAIModel(modelId: OpenAIModelId): ResolvedModel {
  return {
    model: openai(modelId as Parameters<typeof openai>[0]),
    provider: "openai",
    modelId,
    providerOptions: OPENAI_PROVIDER_OPTIONS[modelId],
  };
}

function resolveGoogleModel(modelId: GoogleModelId): ResolvedModel {
  return {
    model: google(modelId as Parameters<typeof google>[0]),
    provider: "google",
    modelId,
    providerOptions: GOOGLE_PROVIDER_OPTIONS[modelId],
  };
}

function resolveXaiModel(modelId: XaiModelId): ResolvedModel {
  return {
    model: xai(modelId as Parameters<typeof xai>[0]),
    provider: "xai",
    modelId,
    providerOptions: XAI_PROVIDER_OPTIONS[modelId],
  };
}

function resolveDeepSeekModel(modelId: DeepSeekModelId): ResolvedModel {
  return {
    model: deepseek(modelId as Parameters<typeof deepseek>[0]),
    provider: "deepseek",
    modelId,
    providerOptions: DEEPSEEK_PROVIDER_OPTIONS[modelId],
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

    case "xai":
      return resolveXaiModel(model.id);

    case "deepseek":
      return resolveDeepSeekModel(model.id);

    default:
      return assertUnsupportedProvider(model);
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
