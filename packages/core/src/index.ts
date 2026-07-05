// packages/core/src/index.ts

export { maxintel, MaxintelRouter } from "./router";
export { openaiProvider } from "./providers/openai";
export { geminiProvider } from "./providers/gemini";
export type {
  TextGenerationProvider,
  GenerateTextInput,
  GenerateTextResult,
  GenerationType,
} from "./types";
