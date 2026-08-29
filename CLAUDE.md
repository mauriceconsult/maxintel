<!-- D:/maxintel/CLAUDE.md -->
# Maxintel

Bun monorepo. AI failover router for Max AI Studio.
Packages: @maxintel/shared, @maxintel/database (Prisma/Neon), @maxintel/server (Hono), @maxintel/cli (OpenTUI).

## Key commands
- Dev server: `bun run dev:server`
- Type check: `bun run type-check`
- DB migrate: `bun run --filter @maxintel/database db:migrate`
- Deploy: git push → Vercel auto-deploys to maxintel.maxnovate.com

## Stack
TypeScript, Bun, Hono, Prisma (Neon PostgreSQL), Clerk auth, @ai-sdk/anthropic → OpenAI → Gemini failover.

## MTN MoMo
Collections: MOMO_PRIMARY_KEY + MOMOUSER_ID + MOMOUSER_SECRET
Disbursements: MOMO_PRIMARY_KEY_DISBURSEMENTS + MOMO_DISBURSE_USER_ID + MOMO_DISBURSE_USER_SECRET
Currently: sandbox → moving to production. X-Target-Environment must switch to "mtncongo" or "mtnuganda".
Webhook: https://maxintel.maxnovate.com/billing/webhook

## Do not
- Run prisma migrate reset
- Commit .env files
- Use Bun.env (use process.env — Vercel compatibility)