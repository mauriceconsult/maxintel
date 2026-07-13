export type ModelPricing = {
  inputUsdPerMilliontokens: number;
  outputUsdPerMilliontokens: number;
};
export type SupportedProvider = "anthropic" | "openai";

type SupportedChatModelDefinition = {
  id: string;
  provider: SupportedProvider;
  pricing: ModelPricing;
};
export const SUPPORTED_CHAT_MODELS = [
  {
    id: "claude-sonnet-4-6",
    provider: "anthropic",
    pricing: {
      inputUsdPerMilliontokens: 3,
      outputUsdPerMilliontokens: 15,
    },
  },
  {
    id: "claude-haiku-4-5",
    provider: "anthropic",
    pricing: {
      inputUsdPerMilliontokens: 1,
      outputUsdPerMilliontokens: 5,
    },
  },
  {
    id: "claude-opus-4-6",
    provider: "anthropic",
    pricing: {
      inputUsdPerMilliontokens: 5,
      outputUsdPerMilliontokens: 25,
    },
  },
  {
    id: "gpt-5.4",
    provider: "openai",
    pricing: {
      inputUsdPerMilliontokens: 2.5,
      outputUsdPerMilliontokens: 15,
    },
  },
  {
    id: "gpt-5.4-mini",
    provider: "openai",
    pricing: {
      inputUsdPerMilliontokens: 0.75,
      outputUsdPerMilliontokens: 4.5,
    },
  },
  {
    id: "gpt-5.4-nano",
    provider: "openai",
    pricing: {
      inputUsdPerMilliontokens: 0.2,
      outputUsdPerMilliontokens: 1.25,
    },
  },
] as const satisfies readonly SupportedChatModelDefinition[];
export type SupportedChatModel = (typeof SUPPORTED_CHAT_MODELS)[number];
export type SupportedChatModelId = SupportedChatModel["id"];
export function findSupportedChatModel(modelId: string) {
  return SUPPORTED_CHAT_MODELS.find((model) => model.id === modelId);
}
export const DEFAULT_CHAT_MODEL_ID: SupportedChatModelId = "claude-opus-4-6";

