# KiwiMart — Production Runbook

> Last updated: 2026-03-25

---

## Deployment

### Automatic deployment (normal flow)

Push to `main` branch → GitHub Actions runs CI → deploys to Vercel automatically.

```bash
git push origin main
```

Monitor at: https://github.com/vinodp297/kiwimart/actions

### Manual deployment

```bash
vercel --prod \
  --token=YOUR_VERCEL_TOKEN \
  --name=kiwimart \
  --yes
```

### Verify deployment

```bash
curl https://kiwimart.vercel.app/api/health
```

Expected:
```json
{"status":"ok","services":[{"name":"database","status":"ok"},{"name":"redis","status":"ok"},{"name":"stripe","status":"ok"}]}
```

---

## Rollback Procedure

### Instant rollback via Vercel dashboard (< 2 minutes)

1. Go to [vercel.com](https://vercel.com) → **kiwimart** project
2. Click **Deployments** tab
3. Find the last known-good deployment
4. Click the three-dots menu → **Promote to Production**
5. Verify: `curl https://kiwimart.vercel.app/api/health`

### Rollback via Git revert

```bash
git log --oneline -10          # identify the bad commit
git revert HEAD                # creates a new revert commit
git push origin main           # triggers automatic redeploy
```

---

## Database Migrations

### Safe migration (recommended)

```bash
npm run db:migrate:safe
```

Checks for destructive operations (DROP TABLE, DROP COLUMN) and prompts for confirmation before proceeding.

### Production migration (CI/CD)

```bash
npx prisma migrate deploy
npx prisma generate
```

### Emergency rollback of a migration

Prisma does not support automatic migration rollback. Manual steps:

1. Identify the breaking migration in `prisma/migrations/`
2. Write a compensating migration that reverses the change
3. Test against a copy of the production database first
4. Apply the compensating migration: `npm run db:migrate:safe`

### ⚠️ Never use `db:push` in production

`prisma db push` bypasses migration history and can cause schema drift.
Always use `prisma migrate deploy` in production.

---

## Incident Response

### Payment processing down

1. Check Stripe status: https://status.stripe.com
2. Check `/api/health` — look at `stripe` service entry
3. Check Sentry for error details
4. Check Vercel logs for recent 5xx errors
5. If Stripe webhook failing: check **Stripe Dashboard → Developers → Webhooks**

### High error rate

1. Check Sentry dashboard for error spike
2. Check Vercel runtime logs (Vercel Dashboard → Functions tab)
3. Check `/api/health` — identify which service reports `"status":"error"`
4. If DB issue: check [Neon console](https://console.neon.tech)
5. If Redis issue: check [Upstash console](https://console.upstash.com)

### Auto-release cron not running

1. Check Vercel → Project → **Settings → Cron Jobs**
2. Verify `CRON_SECRET` env var is set in Vercel
3. Manually trigger:
   ```bash
   curl -H "Authorization: Bearer YOUR_CRON_SECRET" \
     https://kiwimart.vercel.app/api/cron/auto-release
   ```

### Stuck orders (DISPATCHED but not auto-released after 7 days)

1. Call `GET /api/metrics` (admin session required) to see order counts
2. Check `/api/health` for service health
3. Manually trigger auto-release cron (see above)
4. If still stuck: query `AuditLog` table for the affected order ID

### Banned user still accessing the site

Session-level ban checks run in `proxy.ts`. If a banned user has an active session:
1. Find their session token in the `Session` table
2. Delete the row: `DELETE FROM "Session" WHERE "userId" = 'xxx'`
3. The proxy will block their next request

---

## Environment Variables

See `.env.production.example` for the full list of required variables.
All variables must be set in the **Vercel Dashboard → Project Settings → Environment Variables**.

### Verify env vars locally

```bash
npm run check-env
```

### Adding a new required env var

1. Add it to `.env.local` (local development)
2. Add it to `.env.production.example` with a placeholder value
3. Add it to `.github/SECRETS.md`
4. Add it to `.github/workflows/ci.yml` (both test and build steps)
5. Add it to `scripts/check-env.ts` `REQUIRED_VARS` array
6. Set it in Vercel Dashboard and GitHub Secrets

---

## Key URLs

| URL | Purpose |
|-----|---------|
| https://kiwimart.vercel.app | Production site |
| https://kiwimart.vercel.app/api/health | Health check (public) |
| https://kiwimart.vercel.app/api/metrics | Business metrics (admin only) |
| https://console.neon.tech | Database console |
| https://console.upstash.com | Redis console |
| https://dashboard.stripe.com | Payments console |
| https://resend.com/emails | Email logs |
| https://vercel.com/63media/kiwimart | Deployment console |
| https://github.com/vinodp297/kiwimart/actions | CI/CD pipelines |

---

## Useful Commands

```bash
# Check all env vars are set
npm run check-env

# Run tests
npx vitest run

# TypeScript check
npx tsc --noEmit

# Safe migration
npm run db:migrate:safe

# Open Prisma Studio (local DB browser)
npm run db:studio

# Check production health
curl https://kiwimart.vercel.app/api/health | python3 -m json.tool
```
