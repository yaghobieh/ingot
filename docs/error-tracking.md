# Error tracking (IDEA-149)

Ingot reports crashes to any Sentry-compatible endpoint. **It is off unless `SENTRY_DSN` is set.**

| Process | What is captured | Code |
|---|---|---|
| Electron main | `uncaughtException`, `unhandledRejection` | `electron-main/ingot-electron-main-module.ts` |
| Backend (Node) | `uncaughtException`, `unhandledRejection` | `node/error-reporting-endpoint.ts` |
| Renderer | `window.error`, `unhandledrejection` (max 10 per session) | `browser/error-reporting-contribution.ts` |

The renderer reads the DSN from the backend (`GET /ingot/error-reporting`), so nothing is baked into the bundle.
A DSN is a public key, not a secret.

## Privacy

- Only the error message, stack and a few tags are sent: no user ids, prompts, code or file contents.
- Messages and stacks are scrubbed of bearer tokens, API keys, GitHub tokens, JWTs, URL credentials and
  token/key query parameters, emails, IP addresses, UUIDs and the home-folder user name. Tags with sensitive names
  (password, secret, token, key, cookie, email, card…) are dropped. See `common/telemetry/error-reporter.ts`
  (same scrubber as the server and portal).

## Turning it on

```bash
SENTRY_DSN=https://<public-key>@<host>/<project> SENTRY_ENVIRONMENT=production
```

Set these where the app starts (the Electron main process passes its env to the backend).
