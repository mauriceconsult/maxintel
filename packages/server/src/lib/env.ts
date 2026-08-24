// packages/server/src/lib/env.ts
// Bun aliases process.env → Bun.env natively, so process.env works on both
export const env = process.env as Record<string, string | undefined>;
