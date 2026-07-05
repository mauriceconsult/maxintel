// packages/core/src/providers/openai.ts

// @ts-ignore
const OpenAI = require("openai");
import type {
  TextGenerationProvider,
  GenerateTextInput,
  GenerateTextResult,
} from "../types";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODEL = process.env.MAXINTEL_OPENAI_MODEL ?? "gpt-4o-mini";

const MAX_TOKENS: Record<string, number> = {
  blog_post: 2000,
  action_plan: 2000,
  social_media: 500,
  email: 800,
  product_description: 600,
  summary: 600,
};

export const openaiProvider: TextGenerationProvider = {
  name: "openai",

  async generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
    const response = await client.chat.completions.create({
      model: MODEL,
      max_tokens: MAX_TOKENS[input.type] ?? 1000,
      messages: [{ role: "user", content: input.prompt }],
    });

    const choice = response.choices[0];
    const text = choice.message.content ?? "";

    return {
      output: text,
      provider: "openai",
      model: response.model,
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
      totalTokens: response.usage?.total_tokens ?? 0,
    };
  },
};
