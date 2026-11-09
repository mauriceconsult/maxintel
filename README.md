# MaxIntel

MaxIntel is an AI failover router with a Hono API server and a Bun-based CLI.
The API is configured for deployment to Vercel and uses PostgreSQL through
Prisma.

## Requirements

- Bun 1.3.14 (the version used by CI and declared in `package.json`)
- A PostgreSQL database for running the server
- Clerk credentials and at least one supported AI provider key to use the API

## Local development

```sh
bun install --frozen-lockfile
cp .env.example .env
```

Set `DATABASE_URL`, `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, and at least
one provider key in `.env`. the example file also documents optional CLI, monitoring, checkout, MTN MoMo,
and Safaricom Daraja settings. Never commit `.env` or production credentials.

Then run:

```sh
bun run type-check
bun run dev:server
```

The API listens on `http://localhost:3000`. To run the CLI in another
terminal, use `bun run dev:cli`. For a production-shaped build, run
`bun run build`; the server bundle is written to `packages/server/dist`.

## Vercel deployment

Create a Vercel project rooted at the repository root. The included
`vercel.json` builds the workspace packages and routes requests to the Hono
server. Configure these values in Vercel's Environment Variables for each
target environment:

- `DATABASE_URL` — PostgreSQL connection string
- `CLERK_SECRET_KEY` and `CLERK_PUBLISHABLE_KEY`
- At least one provider API key (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
  `GOOGLE_GENERATIVE_AI_API_KEY`, `XAI_API_KEY`, or `DEEPSEEK_API_KEY`)
- `CHECKOUT_TOKEN_SECRET` — a stable, randomly generated secret for checkout
  links if browser checkout is enabled
- `PUBLIC_BASE_URL` — the public origin, for example
  `https://your-domain.example`
- `SENTRY_DSN` and `PLATFORM_ADMIN_KEY` if those features are enabled
- MTN MoMo credentials and the correct `MOMO_TARGET_ENVIRONMENT`,
  `MOMO_ENV`, `MOMO_CURRENCY`, and public `MOMO_CALLBACK_HOST` only if payments
  are enabled
- Safaricom Daraja `DARAJA_CONSUMER_KEY`, `DARAJA_CONSUMER_SECRET`,
  `DARAJA_SHORTCODE`, `DARAJA_PASSKEY`, and the publicly reachable HTTPS
  `DARAJA_CALLBACK_URL` to enable M-PESA STK Push in the checkout. Set
  `DARAJA_KES_PER_UGX` to the current KES-per-UGX exchange rate; bundle charges
  are converted and rounded up to the nearest whole KES.

After provisioning the database, apply committed migrations with:

```sh
bun run --filter @maxintel/database db:deploy
```

Do not use `db:push` or `db:migrate` as a production release step. Configure
the public domain and Clerk redirect/origin settings to match the deployment.
For CLI OAuth, also set `CLERK_FRONTEND_API` and `CLERK_OAUTH_CLIENT_ID`, and
allow the local callback URL `http://127.0.0.1:4001/callback` in the OAuth
provider configuration.

## Validation

CI checks the workspace build and type-check on Linux, macOS, and Windows.
Run `bun run type-check` and `bun run build:cli` locally before opening a PR.