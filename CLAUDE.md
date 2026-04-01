@AGENTS.md

## Auth & Security

### Turnstile (CAPTCHA)

- Dev bypass: `/api/auth/turnstile-config` returns `{ siteKey: null, active: false }` in non-production
- No Turnstile script is injected in dev — widget never loads, registration flows straight through
- Server-side verification is skipped using the same guard condition: `NODE_ENV !== 'production' || !TURNSTILE_SECRET_KEY`
- Both the config endpoint and server verification must use the same condition to avoid staging mismatches
- Historical note: original production login failure was caused by lowercase 'l' vs '1' character confusion in TURNSTILE_SECRET_KEY — resolved via Cloudflare key rotation and forced Vercel redeploy
