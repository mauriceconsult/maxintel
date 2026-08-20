export type ModelPricing = {
  inputUsdPerMilliontokens: number;
  outputUsdPerMilliontokens: number;
};

export type SupportedProvider =
  | "anthropic"
  | "openai"
  | "google"
  | "xai"
  | "deepseek";

type SupportedChatModelDefinition = {
  id: string;
  provider: SupportedProvider;
  pricing: ModelPricing;
};

export const SUPPORTED_CHAT_MODELS = [
  // -------------------------
  // OpenAI
  // -------------------------
  {
    id: "gpt-5.6-terra",
    provider: "openai",
    pricing: {
      inputUsdPerMilliontokens: 2.5,
      outputUsdPerMilliontokens: 10,
    },
  },
  {
    id: "gpt-5.6-sol",
    provider: "openai",
    pricing: {
      inputUsdPerMilliontokens: 15,
      outputUsdPerMilliontokens: 60,
    },
  },
  {
    id: "gpt-5.6-luna",
    provider: "openai",
    pricing: {
      inputUsdPerMilliontokens: 0.3,
      outputUsdPerMilliontokens: 1.2,
    },
  },

  // -------------------------
  // Google
  // -------------------------
  {
    id: "gemini-2.5-pro",
    provider: "google",
    pricing: {
      inputUsdPerMilliontokens: 1.25,
      outputUsdPerMilliontokens: 10,
    },
  },
  {
    id: "gemini-2.5-flash",
    provider: "google",
    pricing: {
      inputUsdPerMilliontokens: 0.3,
      outputUsdPerMilliontokens: 2.5,
    },
  },
  {
    id: "gemini-2.5-flash-lite",
    provider: "google",
    pricing: {
      inputUsdPerMilliontokens: 0.1,
      outputUsdPerMilliontokens: 0.4,
    },
  },

  // -------------------------
  // Anthropic
  // -------------------------
  {
    id: "claude-opus-4-6",
    provider: "anthropic",
    pricing: {
      inputUsdPerMilliontokens: 15,
      outputUsdPerMilliontokens: 75,
    },
  },
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

  // -------------------------
  // xAI (Grok)
  // -------------------------
  {
    id: "grok-4.5",
    provider: "xai",
    pricing: {
      inputUsdPerMilliontokens: 2.0,
      outputUsdPerMilliontokens: 6.0,
    },
  },

  // -------------------------
  // DeepSeek
  // -------------------------
  {
    id: "deepseek-chat",
    provider: "deepseek",
    pricing: {
      inputUsdPerMilliontokens: 0.28,
      outputUsdPerMilliontokens: 0.42,
    },
  },
  {
    id: "deepseek-reasoner",
    provider: "deepseek",
    pricing: {
      inputUsdPerMilliontokens: 0.55,
      outputUsdPerMilliontokens: 2.19,
    },
  },
] as const satisfies readonly SupportedChatModelDefinition[];

export type SupportedChatModel = (typeof SUPPORTED_CHAT_MODELS)[number];
export type SupportedChatModelId = SupportedChatModel["id"];

export function findSupportedChatModel(modelId: string) {
  return SUPPORTED_CHAT_MODELS.find((model) => model.id === modelId);
}

/** Prefer a low-cost default for production traffic; switch via env if needed. */
export const DEFAULT_CHAT_MODEL_ID: SupportedChatModelId =
  "claude-sonnet-4-6";
  // "gemini-2.5-flash-lite";
