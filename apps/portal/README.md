# Ingot portal (`apps/portal`)

The web portal for Ingot (like a cursor.com/dashboard for Ingot): landing and pricing, sign in / sign up
(email code, GitHub, Google), usage dashboard, usage table + CSV, models, plan & billing, API keys and
bring-your-own-key, team members with roles, settings, and **Sign in from Ingot** (device code flow)
with a small REST API the IDE calls.

Stack: Next.js (App Router) + TypeScript, Postgres (`pg`), Bear UI components, i18n en/he/es (Hebrew is RTL),
Ingot design tokens (`assets/brand/tokens.css`), light and dark themes.

## Run locally

```bash
cd apps/portal
npm ci
cp ingot.config.example.json ingot.config.json   # gitignored; fill database.url, security.encryptionKey
npm run db:migrate
npm run build && npm start                       # http://localhost:3200
```

Throwaway Postgres for dev/tests (any local Postgres works):

```bash
docker run -d --name ingot-portal-pg -e POSTGRES_USER=ingot -e POSTGRES_PASSWORD=<choose one> \
  -e POSTGRES_DB=ingot_portal -p 127.0.0.1:5434:5432 postgres:16-alpine
docker exec ingot-portal-pg psql -U ingot -c "CREATE DATABASE ingot_portal_test"
```

`security.encryptionKey` is 32 random bytes, base64 (`openssl rand -base64 32`). It encrypts BYOK keys (AES-256-GCM).

## Config (`ingot.config.json`, gitignored)

| Key | What it does |
| --- | --- |
| `appUrl` | Public URL; used for OAuth redirects, invite and device links |
| `database.url` / `database.testUrl` | Postgres; `testUrl` must end in `_test` and is wiped by e2e |
| `security.encryptionKey` | BYOK encryption key |
| `email.provider` | `outbox` (dev: stored in DB, nothing sent) or `resend` (+ `resendApiKey`, `from`) |
| `oauth.github` / `oauth.google` | Client id + secret. Missing = the button is shown disabled |
| `billing.provider` | `stub` (default) or `lemonsqueezy` (+ `apiKey`, `storeId`, `webhookSecret`, `variants.pro/team`) |
| `features.devOutbox` | Dev/test only: `GET /api/dev/outbox?email=` returns sent codes |
| `features.sampleData` | Shows "Load sample usage" on an empty dashboard |

OAuth redirect URIs: `<appUrl>/api/auth/oauth/github/callback` and `<appUrl>/api/auth/oauth/google/callback`.
Lemon Squeezy webhook URL: `<appUrl>/api/billing/webhook` (subscription events, HMAC-verified with `webhookSecret`).

Paid plan prices are **TBD** in `src/constants/plans.consts.ts` until they are decided.

## IDE API

Auth with `Authorization: Bearer ingot_pat_…` (from device sign-in or the API keys page). Postman collection: `postman/`.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/device/code` | Start device sign-in → `device_code`, `user_code`, `verification_uri_complete`, `interval` |
| POST | `/api/device/token` | Poll with `device_code` → `authorization_pending` / `access_denied` / `expired_token` / `access_token` (issued once) |
| GET / PATCH | `/api/me` | Account, plan, billing and synced settings |
| GET / POST | `/api/usage` | Summary (`?days=7|30|90`) or rows (`?view=rows&page=`); POST `{ events: [...] }` |
| GET / PUT | `/api/settings` | Synced settings `{ data, version }`; PUT `{ data, baseVersion }` → 409 when stale |

## Checks

```bash
npm run gate        # eslint + tsc + vitest
npm run build
npm run e2e         # Playwright click-through, light + dark, on a throwaway DB (E2E_DATABASE_URL or database.testUrl)
npm run secret-scan
```

Code layout: `src/app` (pages and `api/**/route.ts`) → `src/server/controllers` → `src/server/services` → `src/server/db`.
Types live in `*.types.ts`, constants in `*.consts.ts`, imports use path aliases (`@/`, `@server/`, `@components/`, `@i18n/`).
