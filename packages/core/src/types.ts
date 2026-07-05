// packages/core/src/types.ts

export type GenerationType =
  | "blog_post"
  | "social_media"
  | "email"
  | "product_description"
  | "action_plan"
  | "summary";

export interface GenerateTextInput {
  prompt: string;
  type: GenerationType;
}

export interface GenerateTextResult {
  output: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface TextGenerationProvider {
  name: string;
  generateText: (input: GenerateTextInput) => Promise<GenerateTextResult>;
}
