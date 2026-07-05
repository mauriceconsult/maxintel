// packages/core/src/providers/gemini.ts

// @ts-ignore: no type declarations for @google/generative-ai
const { GoogleGenerativeAI } = require("@google/generative-ai") as any;
import type {
  TextGenerationProvider,
  GenerateTextInput,
  GenerateTextResult,
} from "../types";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? "");
const MODEL = process.env.MAXINTEL_GEMINI_MODEL ?? "gemini-1.5-flash";

export const geminiProvider: TextGenerationProvider = {
  name: "gemini",

  async generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
    const model = genAI.getGenerativeModel({ model: MODEL });
    const result = await model.generateContent(input.prompt);
    const response = result.response;
    const text = response.text();

    // Gemini returns token counts in usageMetadata
    const usage = response.usageMetadata;

    return {
      output: text,
      provider: "gemini",
      model: MODEL,
      promptTokens: usage?.promptTokenCount ?? 0,
      completionTokens: usage?.candidatesTokenCount ?? 0,
      totalTokens: usage?.totalTokenCount ?? 0,
    };
  },
};
