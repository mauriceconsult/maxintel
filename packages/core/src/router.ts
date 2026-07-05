// packages/core/src/router.ts
//
// Tries each provider in order. If one throws, logs the failure and
// moves to the next. Returns the first successful result.
// Max AI Studio imports this and uses it when Anthropic is unavailable.

import type {
  TextGenerationProvider,
  GenerateTextInput,
  GenerateTextResult,
} from "./types";
import { openaiProvider } from "./providers/openai";
import { geminiProvider } from "./providers/gemini";

// Order = priority. Add more providers here as Maxintel grows.
const PROVIDERS: TextGenerationProvider[] = [openaiProvider, geminiProvider];

export class MaxintelRouter {
  private providers: TextGenerationProvider[];

  constructor(providers: TextGenerationProvider[] = PROVIDERS) {
    this.providers = providers;
  }

  async generate(input: GenerateTextInput): Promise<GenerateTextResult> {
    const errors: string[] = [];

    for (const provider of this.providers) {
      try {
        const result = await provider.generateText(input);
        console.log(`[Maxintel] Success via ${provider.name}`);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[Maxintel] ${provider.name} failed: ${message}`);
        errors.push(`${provider.name}: ${message}`);
      }
    }

    throw new Error(`[Maxintel] All providers failed:\n${errors.join("\n")}`);
  }

  // Health check — useful for Studio's admin dashboard
  async healthCheck(): Promise<Record<string, "ok" | "error">> {
    const results: Record<string, "ok" | "error"> = {};

    await Promise.allSettled(
      this.providers.map(async (p) => {
        try {
          await p.generateText({ prompt: "ping", type: "summary" });
          results[p.name] = "ok";
        } catch {
          results[p.name] = "error";
        }
      }),
    );

    return results;
  }
}

export const maxintel = new MaxintelRouter();
