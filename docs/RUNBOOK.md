# Incident Response Runbook

## Severity Levels

| Level | Description                                   |
| ----- | --------------------------------------------- |
| P0    | Site down, payments failing, data loss        |
| P1    | Major feature broken (listings, orders, auth) |
| P2    | Minor feature broken, performance degraded    |
| P3    | Cosmetic issue, single user affected          |

## Response Times

| Level | Target                                        |
| ----- | --------------------------------------------- |
| P0    | Immediate — fix or rollback within 30 minutes |
| P1    | Within 2 hours                                |
| P2    | Within 24 hours                               |
| P3    | Next sprint                                   |

## P0 Playbook — Site Down

1. Check Vercel status: https://vercel.com/status
2. Check Neon status: https://neon.tech/status
3. Check health endpoint: `curl https://[domain]/api/health`
4. Check Sentry for error spike
5. Check last deployment — if recent, rollback immediately:
   Vercel dashboard → Deployments → previous deploy → Redeploy
6. Check Neon database connections:
   `curl https://[domain]/api/health`

## P0 Playbook — Payments Failing

1. Check Stripe dashboard for API errors
2. Check webhook delivery: Stripe → Webhooks → recent events
3. Check STRIPE_WEBHOOK_SECRET env var is set correctly
4. Check Sentry for stripe-related errors
5. If webhook failing: Stripe dashboard → resend failed events

## P0 Playbook — Database Down

1. Check Neon dashboard for outage
2. If Neon outage: wait (they have 99.9% SLA)
3. If connection limit hit: restart Vercel deployment to reset pools
4. Emergency: switch DATABASE_URL to staging branch as read-only

## Failed Job Recovery (Dead-Letter Queue)

When a BullMQ job fails all 3 retry attempts it stays in the queue's "failed" set permanently (`removeOnFail: false`). These jobs are the dead-letter queue (DLQ). Failed payout jobs mean sellers are not paid; failed pickup jobs mean buyers miss OTP notifications.

### Checking failed jobs

```bash
# GET /api/admin/jobs/failed  (requires admin auth with VIEW_SYSTEM_HEALTH)
curl -s -H "Cookie: <session_cookie>" \
  "https://[domain]/api/admin/jobs/failed" | jq .
```

The response includes every queue's failed count and the 50 most recent failed jobs per queue. Each job includes:

- `id` — the BullMQ job ID (used for retry)
- `failedReason` — the error message from the last attempt
- `attemptsMade` — how many times it was tried (max 3)
- `correlationId` — links back to the originating HTTP request; search structured logs and Sentry by this ID to trace what happened
- `createdAt` / `failedAt` — timestamps for when the job was enqueued and when it finally failed

### Retrying a specific job

```bash
# POST /api/admin/jobs/:jobId/retry  (requires admin auth with VIEW_SYSTEM_HEALTH)
curl -s -X POST \
  -H "Cookie: <session_cookie>" \
  -H "Content-Type: application/json" \
  -d '{"queueName": "payout"}' \
  "https://[domain]/api/admin/jobs/<JOB_ID>/retry"
```

This moves the job from "failed" back to "waiting" so BullMQ will process it again (with a fresh set of 3 attempts).

### When to retry vs investigate first

| Scenario                                                    | Action                                                          |
| ----------------------------------------------------------- | --------------------------------------------------------------- |
| `failedReason` mentions timeout / connection refused        | Likely transient — safe to retry                                |
| `failedReason` mentions invalid data / validation error     | Investigate first — retrying will fail again                    |
| Same job has been manually retried 2+ times                 | Investigate — the root cause is not transient                   |
| Multiple jobs in the same queue failed around the same time | Check the dependency (Stripe, Redis, DB) status before retrying |

### What correlationId means

Every HTTP request that enters the proxy is assigned a UUID (`x-correlation-id`). This ID is threaded through:

- Structured log lines (`correlationId` field)
- BullMQ job data (`correlationId` field)
- Stripe payment metadata (`correlationId`)
- Sentry error tags (`correlationId`)

To trace a failed job back to its origin: search structured logs for the job's `correlationId`. This shows the full request lifecycle — from the API call that enqueued the job through to the job's own processing logs.

## Common Issues

### Images Not Loading

- Check Cloudflare R2 status
- Check CLOUDFLARE*R2*\* env vars in Vercel
- Check getImageUrl() returns correct domain

### Cron Jobs Not Running

- Check Vercel dashboard → Cron Jobs tab
- Verify Vercel Pro plan is active (free plan = 1 cron only)
- Check /api/cron/[name] route exists and returns 200

### Workers Not Processing

- Check Railway dashboard for worker status
- Check Upstash Redis dashboard for queue depth
- Restart worker service in Railway if needed

### High Error Rate

- Check Sentry for error grouping
- Check if recent deployment caused it
- Rollback deployment if error rate > 5%

## Deploy Pipeline

The CI/CD pipeline (`.github/workflows/deploy.yml`) runs four jobs in strict sequence on every push to `main`:

```
validate → deploy → migrate → verify
```

### Job descriptions

| Job          | Purpose                                                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **validate** | Lint, type-check, test, and build the full app. Broken code never reaches production.                                                                         |
| **deploy**   | Push new code to Vercel production via `vercel --prod`. Captures the previous deployment ID for rollback.                                                     |
| **migrate**  | Run `npx prisma migrate deploy` against the production database. Runs AFTER deploy so a failed deploy doesn't leave the DB schema ahead of the running code.  |
| **verify**   | Hit `/api/health` with 5 retries (10 s apart). On failure, automatically rolls back by promoting the previous Vercel deployment back to the production alias. |

### Why this order matters

- **validate before deploy**: guarantees only green builds reach production.
- **migrate after deploy**: if the deploy fails, the database stays in sync with the still-running code. A migration that ran before a failed deploy would leave the schema ahead of the app.
- **verify after migrate**: the health check confirms the new code + new schema work together in production.

### What to do when a job fails

#### validate fails

The deploy never happened — production is unaffected.

1. Read the GitHub Actions log to identify the failing step (lint / tsc / test / build).
2. Fix the issue on a branch, open a PR, merge to `main` to re-trigger the pipeline.

#### deploy fails

No code reached production. Migrations did not run.

1. Check the Vercel CLI output in the Actions log for the error.
2. Common causes: expired `VERCEL_TOKEN`, Vercel outage, build timeout.
3. Re-run the workflow from the Actions tab, or fix and push again.

#### migrate fails — P0 INCIDENT

Code is deployed but the database schema may be behind. This is the most dangerous failure mode.

1. **Do NOT auto-rollback migrations** — rolling back schema changes can cause data loss.
2. Read the Prisma error output in the Actions log.
3. Fix the migration SQL and run manually:
   ```bash
   # From a machine with network access to the production DB
   DATABASE_URL="<production connection string>" npx prisma migrate deploy
   ```
4. If the new code cannot function without the migration, manually rollback the application (see below) while you fix the migration, then redeploy.

#### verify fails (health check)

The pipeline automatically rolls back by promoting the previous deployment. Check the Actions summary for confirmation.

1. If automatic rollback succeeded: investigate why the health check failed (check `/api/health` response, Vercel function logs, Sentry).
2. If automatic rollback failed: manually rollback (see below).
3. **Note**: database migrations are NOT reverted by a rollback. If the rolled-back code is incompatible with the new schema, you may need to manually fix the schema or fast-forward a code fix.

### Manual rollback

If the automated rollback fails or you need to rollback outside the pipeline:

**Option A — Vercel Dashboard (fastest)**

1. Go to Vercel → Project → Deployments.
2. Find the last known-good deployment (status: Ready).
3. Click the three-dot menu → "Promote to Production".

**Option B — Vercel API**

```bash
# 1. Find the previous deployment ID
curl -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v6/deployments?app=kiwimart&target=production&limit=5&state=READY" \
  | jq '.deployments[] | {uid, created: .created, url: .url}'

# 2. Promote it back to the production alias
curl -X POST \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"alias":"kiwimart.vercel.app"}' \
  "https://api.vercel.com/v2/deployments/<DEPLOYMENT_ID>/aliases"
```

**Option C — Vercel CLI**

```bash
vercel rollback --token=$VERCEL_TOKEN
```

### Manual migration

To run Prisma migrations manually against production:

```bash
# Ensure you have the production DATABASE_URL (from Vercel env vars or Neon dashboard)
export DATABASE_URL="postgresql://user:pass@host/db?sslmode=require"

# Check migration status
npx prisma migrate status

# Apply pending migrations
npx prisma migrate deploy

# If a migration is corrupt/stuck, check Prisma's _prisma_migrations table:
# SELECT * FROM _prisma_migrations ORDER BY started_at DESC LIMIT 5;
```

**Never run `prisma migrate dev` against production** — it resets the database. Always use `prisma migrate deploy`.

### Rollback limitations

> **IMPORTANT:** Automatic rollback reverts application CODE only. Database migrations are NOT rolled back automatically. If a migration caused the failure, manual intervention is required — see "Manual migration rollback" below.

The verify job retries the health check 5 times (15 s apart) before deciding to roll back. The decision logic:

| Health status           | HTTP code | Action                                                          |
| ----------------------- | --------- | --------------------------------------------------------------- |
| `ok`                    | 200       | Pass — deployment verified                                      |
| `degraded`              | 200       | Pass with warning — partial functionality, investigate promptly |
| `unhealthy`             | 503       | After 5 failed attempts → automatic rollback                    |
| Network error / timeout | N/A       | After 5 failed attempts → automatic rollback                    |

"Degraded" does **not** trigger a rollback because partial functionality is better than a rollback that may introduce schema/code mismatch.

### Manual migration rollback

If a migration itself caused the health check failure:

1. The automatic rollback will restore the previous application code.
2. The database schema is now **ahead** of the running code.
3. Assess whether the rolled-back code can tolerate the new schema (additive migrations usually can; destructive ones cannot).
4. If incompatible: manually revert the migration SQL against the production database, then verify the health endpoint.
5. Fix the migration, re-test locally, and redeploy.

## Monitoring Checklist (Daily)

- [ ] Sentry error rate < 0.1%
- [ ] Health endpoint returning 200
- [ ] Vercel function execution times < 8s
- [ ] Neon compute hours < 80% of plan limit
- [ ] Upstash commands < 80% of daily limit
