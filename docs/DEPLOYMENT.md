# Deployment Runbook

## Infrastructure Components

| Service            | Provider             | Purpose                                              | Free Tier                            | Production Recommendation                                      |
| ------------------ | -------------------- | ---------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------- |
| Web Application    | Vercel               | Next.js hosting, serverless functions, cron          | Hobby (1 project, 100GB bandwidth)   | Pro ($20/mo — 10s→60s function timeout, 1TB bandwidth)         |
| Database           | Neon PostgreSQL      | Primary data store                                   | 0.5 GB storage, 1 project            | Scale ($69/mo — autoscaling, branching, point-in-time restore) |
| Prisma Accelerate  | Prisma               | Connection pooling for serverless                    | 50K queries/mo                       | Starter ($29/mo — 500K queries/mo)                             |
| Redis (REST)       | Upstash              | Rate limiting, distributed locks, caching            | 10K commands/day                     | Pay-as-you-go ($0.2/100K commands)                             |
| Redis (TCP)        | Upstash or Railway   | BullMQ job queue backing store                       | Upstash 10K/day or Railway $5 credit | Dedicated Redis on Railway ($5–20/mo)                          |
| Background Workers | Railway              | BullMQ worker process (email, image, payout, pickup) | $5 trial credit                      | Hobby ($5/mo + usage)                                          |
| Payments           | Stripe               | Escrow payments, Connect payouts                     | No monthly fee                       | 2.9% + 30c per transaction (NZ rates may vary)                 |
| Object Storage     | Cloudflare R2        | Listing images and user avatars                      | 10 GB storage, 10M reads/mo          | Pay-as-you-go ($0.015/GB/mo storage)                           |
| Email              | Resend               | Transactional email delivery                         | 100 emails/day                       | Pro ($20/mo — 50K emails/mo)                                   |
| SMS                | Twilio               | Phone verification, pickup OTP codes                 | $15 trial credit                     | Pay-as-you-go (~$0.0075/SMS to NZ)                             |
| Real-Time          | Pusher               | WebSocket messaging and notifications                | 200K messages/day, 100 connections   | Startup ($49/mo — 10K connections)                             |
| Error Monitoring   | Sentry               | Error tracking, alerting, performance                | 5K errors/mo                         | Team ($26/mo — 50K errors/mo)                                  |
| Product Analytics  | PostHog              | User behaviour tracking, feature flags               | 1M events/mo                         | Free tier is generous; Scale at $0.00031/event                 |
| Bot Protection     | Cloudflare Turnstile | CAPTCHA on public forms                              | Unlimited (free)                     | Unlimited (free)                                               |

## Vercel Deployment

### Environment Variables

Every variable from `.env.example` must be set in Vercel's project settings. Critical variables that will cause build failures if missing:

**Required for build:**

- `DATABASE_URL` — Prisma Accelerate pooled connection string
- `DATABASE_DIRECT_URL` — Direct Neon connection (migrations only)
- `NEXTAUTH_SECRET` — JWT signing secret
- `NEXTAUTH_URL` — Production URL (e.g., `https://buyzi.co.nz`)

**Required for runtime:**

- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_CLIENT_ID`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `CLOUDFLARE_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
- `NEXT_PUBLIC_R2_PUBLIC_URL`
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- `RESEND_API_KEY`, `EMAIL_FROM`
- `ENCRYPTION_KEY` — 64-character hex string for field-level encryption
- `CRON_SECRET` — Bearer token for cron authentication
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`

**Optional but recommended:**

- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` — SMS features
- `PUSHER_APP_ID`, `PUSHER_KEY`, `PUSHER_SECRET`, `PUSHER_CLUSTER` — Real-time features
- `NEXT_PUBLIC_PUSHER_KEY`, `NEXT_PUBLIC_PUSHER_CLUSTER`
- `NEXT_PUBLIC_SENTRY_DSN` — Error monitoring
- `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` — Analytics
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `CLOUDFLARE_TURNSTILE_SECRET_KEY` — Bot protection
- `REDIS_URL` — Only needed if running workers on Vercel (not recommended)
- `WORKER_SECRET` — Worker health endpoint auth
- `ADMIN_EMAIL` — Admin notification recipient

### Build Settings

| Setting          | Value             |
| ---------------- | ----------------- |
| Framework Preset | Next.js           |
| Build Command    | `npm run build`   |
| Install Command  | `npm install`     |
| Output Directory | `.next` (default) |
| Node.js Version  | 18.x or 20.x      |
| Region           | `sfo1`            |

### Cron Job Configuration

Defined in `vercel.json`. Vercel automatically invokes these endpoints on schedule, passing `CRON_SECRET` as the Bearer token.

| Path                              | Schedule                   | Description                                     |
| --------------------------------- | -------------------------- | ----------------------------------------------- |
| `/api/cron/auto-release`          | `0 2 * * *` (2 AM UTC)     | Capture escrow for overdue deliveries           |
| `/api/cron/dispute-auto-resolve`  | `0 3 * * *` (3 AM UTC)     | Auto-resolve unresponsive disputes              |
| `/api/cron/expire-listings`       | `30 3 * * *` (3:30 AM UTC) | Expire old listings, release offer reservations |
| `/api/cron/delivery-reminders`    | `0 4 * * *` (4 AM UTC)     | Reminder emails + auto-complete overdue orders  |
| `/api/cron/seller-downgrade`      | `0 6 * * *` (6 AM UTC)     | Downgrade seller tiers on poor metrics          |
| `/api/cron/daily-digest`          | `0 7 * * *` (7 AM UTC)     | Admin summary email                             |
| `/api/cron/stripe-reconciliation` | `0 14 * * *` (2 PM UTC)    | Log payment/order state mismatches              |

### Domain Configuration

1. Add your custom domain in Vercel project settings.
2. Configure DNS: CNAME record pointing to `cname.vercel-dns.com`.
3. Vercel automatically provisions SSL.
4. Update `NEXTAUTH_URL` and `NEXT_PUBLIC_APP_URL` to match the production domain.

## Database (Neon PostgreSQL)

### Connection String Format

```
# Pooled (for application — via Prisma Accelerate)
DATABASE_URL="prisma://accelerate.prisma-data.net/?api_key=..."

# Direct (for migrations only)
DATABASE_DIRECT_URL="postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/kiwimart?sslmode=require"
```

### Running Migrations

```bash
# On deploy (production — applies pending migrations)
npx prisma migrate deploy

# During development (creates new migration)
npx prisma migrate dev --name descriptive_name
```

### Seeding

```bash
# Development seed (sample data)
npx prisma db seed

# Production seed (categories, regions, config)
npx tsx prisma/seed-production.ts
```

### Backup Procedure

1. Neon provides automatic daily backups with point-in-time restore (paid plans).
2. For manual backups: `pg_dump` via the direct connection URL.
3. Neon branching can be used to create instant database copies for staging/testing.

### Branching for Staging

```bash
# Create a branch from production for testing
neon branches create --name staging --parent main
```

Each Neon branch gets its own connection string. Set this as `DATABASE_DIRECT_URL` in your staging environment.

## BullMQ Workers (Render.com)

### What the Worker Process Does

The worker (`src/server/workers/index.ts`) starts four BullMQ workers in a single Node.js process:

1. **Email Worker** — Sends transactional emails via Resend (welcome, offers, dispatch, disputes)
2. **Image Worker** — Downloads images from R2, scans, resizes to 1200px + 480px thumbnail, converts to WebP, strips EXIF/GPS, re-uploads
3. **Payout Worker** — Initiates Stripe Connect transfers to sellers after order completion
4. **Pickup Worker** — Manages pickup lifecycle timeouts (scheduling deadlines, no-show handling, OTP expiry)

### How to Deploy to Render.com

1. Create a new Render.com **Background Worker** service and connect your GitHub repository.
2. Render will detect `render.yaml` automatically — start command is `npm run worker`.
3. Set the required environment variables in the Render dashboard (see below).
4. Deploy. Render.com will run the process continuously with automatic restarts.

### Required Environment Variables

The worker needs a subset of the app's environment variables:

| Variable                    | Purpose                                                                         |
| --------------------------- | ------------------------------------------------------------------------------- |
| `DATABASE_URL`              | Same as the web app (Prisma Accelerate or direct)                               |
| `REDIS_URL`                 | TCP Redis connection for BullMQ (e.g., `redis://...` or `rediss://...` for TLS) |
| `STRIPE_SECRET_KEY`         | For payout transfers                                                            |
| `RESEND_API_KEY`            | For sending emails                                                              |
| `EMAIL_FROM`                | Sender address                                                                  |
| `CLOUDFLARE_ACCOUNT_ID`     | For R2 image operations                                                         |
| `R2_BUCKET_NAME`            | R2 bucket                                                                       |
| `R2_ACCESS_KEY_ID`          | R2 credentials                                                                  |
| `R2_SECRET_ACCESS_KEY`      | R2 credentials                                                                  |
| `NEXT_PUBLIC_R2_PUBLIC_URL` | Public image URL base                                                           |
| `NEXT_PUBLIC_APP_URL`       | For email links                                                                 |
| `ENCRYPTION_KEY`            | For decrypting phone numbers (pickup worker)                                    |

### Health Monitoring

- The worker process logs structured JSON to stdout. Railway captures these automatically.
- Check for `worker.process.ready` log on startup.
- Check for `worker.error` logs for failures.
- BullMQ dashboard (Bull Board) can be added as a separate service if needed.
- Failed jobs are retained in Redis and can be inspected: `npm run workers:check`

## Cloudflare R2

### Bucket Setup

1. Create a bucket in Cloudflare R2 (e.g., `buyzi-images`).
2. Generate an API token with read/write access to the bucket.
3. Note the account ID, access key ID, and secret access key.

### CORS Configuration

R2 requires CORS for direct browser uploads via presigned URLs. Configure in the Cloudflare dashboard:

```json
[
  {
    "AllowedOrigins": ["https://buyzi.co.nz", "http://localhost:3000"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["Content-Type", "Content-Length"],
    "MaxAgeSeconds": 3600
  }
]
```

### Public Access Settings

- Enable public access on the R2 bucket or use a Cloudflare Worker/custom domain for the public URL.
- Set `NEXT_PUBLIC_R2_PUBLIC_URL` to the public access URL (e.g., `https://images.buyzi.co.nz`).
- The image proxy at `/api/images/[...key]` can serve images with caching headers as an alternative to direct R2 public access.

## Monitoring

### Sentry

- **What it monitors:** Uncaught exceptions, unhandled promise rejections, API errors (5xx), and slow transactions.
- **How to access:** Log in at [sentry.io](https://sentry.io), select the KiwiMart project.
- **Configuration:** Set `NEXT_PUBLIC_SENTRY_DSN` in environment variables. The structured logger forwards `.error()` and `.fatal()` calls to Sentry automatically.
- **Alerts:** Configure alert rules in Sentry for error rate spikes and new issue notifications.

### PostHog

- **What it tracks:** Page views, user sign-ups, listing creations, purchases, search queries, and custom events.
- **How to access:** Log in at your PostHog instance (`NEXT_PUBLIC_POSTHOG_HOST`).
- **Configuration:** Set `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST`.

### Vercel Analytics

- **What to watch:** Core Web Vitals (LCP, FID, CLS), function execution duration, cold start times.
- **How to access:** Vercel project dashboard → Analytics tab.
- **Built in:** `@vercel/analytics` and `@vercel/speed-insights` packages are already integrated.

### Health Endpoints

| Endpoint              | Purpose                                 | Auth                         |
| --------------------- | --------------------------------------- | ---------------------------- |
| `/api/ping`           | Basic liveness check                    | None                         |
| `/api/health`         | Application health (DB connectivity)    | None                         |
| `/api/admin/health`   | Detailed health (DB, Redis, Stripe, R2) | Admin auth                   |
| `/api/workers/health` | Worker process health                   | `WORKER_SECRET` Bearer token |

## Incident Response

### High Error Rate

1. Check Sentry for the error spike — identify the affected endpoint or service.
2. Hit `/api/health` to verify the application is responsive.
3. Check Vercel function logs for timeout errors or cold start issues.
4. If database-related: check Neon dashboard for connection limits or slow queries.
5. If Redis-related: check Upstash dashboard for rate limit hits or connectivity issues.

### Payment Failures

1. Check Stripe dashboard (Payments → filter by failed) for the specific error.
2. Check `/api/webhooks/stripe` logs in Vercel for webhook delivery failures.
3. Verify `STRIPE_WEBHOOK_SECRET` matches the current Stripe endpoint configuration.
4. Check `stripe-reconciliation` cron output for logged mismatches.
5. For stuck `PAYMENT_HELD` orders: verify the PaymentIntent status in Stripe matches the DB.

### Database Slowness

1. Check Neon dashboard for active connections (should be well under the limit with Prisma Accelerate pooling).
2. Check Prisma Accelerate dashboard for query latency percentiles.
3. Look for N+1 query patterns in recent deployments.
4. Check if any long-running transactions are holding locks.
5. Consider creating a Neon branch to test query performance in isolation.

### Worker Failures

1. Check Render.com logs for error output from the worker service.
2. Run `npm run workers:check` to inspect failed jobs in BullMQ queues.
3. Check Redis connectivity — if Redis is down, all workers stall.
4. Verify the `REDIS_URL` is correct and the Redis instance has available memory.
5. Check individual queue depth — a large backlog in the `image` queue may indicate R2 connectivity issues; in the `payout` queue may indicate Stripe API issues.

### Real-Time Messaging Down

1. Check Pusher dashboard for connection counts and error rates.
2. Verify `PUSHER_KEY`, `PUSHER_SECRET`, and `PUSHER_CLUSTER` environment variables.
3. Check `/api/pusher/auth` endpoint for authentication errors.
4. Note: messaging falls back gracefully — messages are persisted in the database regardless of Pusher status. Users will see messages on page refresh even if WebSocket delivery fails.

### Bot/Spam Attack

1. Check Upstash dashboard for rate limit hit rates — spikes indicate an attack.
2. Verify Cloudflare Turnstile is active (`NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `CLOUDFLARE_TURNSTILE_SECRET_KEY` are set).
3. Check for bulk account creation in the admin panel.
4. Consider temporarily tightening rate limits in `src/server/lib/rateLimit.ts`.

## Staging Environment Setup

### Neon Branch (Database)

1. Create staging branch in Neon dashboard:
   ```
   neon branches create --name staging --parent main
   ```
2. Get staging connection string from Neon dashboard
3. Add to Vercel as STAGING_DATABASE_URL

### Vercel Preview Environment

1. In Vercel dashboard → Settings → Environment Variables
2. Add all env vars with Environment = "Preview"
3. Use staging Neon branch connection string for DATABASE_URL in Preview
4. Staging URL format: https://kiwimart-git-staging-[team].vercel.app

### What Staging Is Used For

- Testing database migrations before production apply
- QA testing new features
- Load testing without affecting production data
- Verifying cron jobs work correctly

## BullMQ Workers (Railway)

### Why Workers Need Separate Hosting

Vercel serverless functions have a 10-second timeout.
BullMQ workers process: email sending, image processing,
payout scheduling, pickup deadline management.
These need a persistent long-running process.

### Railway Deployment Steps

1. Create account at railway.app
2. New Project → Deploy from GitHub repo
3. Add service → select kiwimart repo
4. Set start command: `node dist/worker.js`
5. Add all environment variables from .env.example
   (same as production Vercel env vars)
6. Set railway.toml in project root (see below)

### railway.toml

```toml
[build]
builder = "nixpacks"
buildCommand = "npm run build:worker"

[deploy]
startCommand = "node dist/worker.js"
restartPolicyType = "on_failure"
restartPolicyMaxRetries = 3
```

### Worker Health Monitoring

- Railway provides automatic restart on failure
- Add WORKER_HEALTH_WEBHOOK to env vars
- Worker pings webhook every 5 minutes
- Sentry captures worker errors automatically

### Estimated Cost

- Railway Hobby: $5/month per worker instance
- 4 workers (email, image, payout, pickup): ~$20/month

## Cloudflare R2 + CDN Setup

### Current State

Images served directly from R2 — no CDN caching.
Every image request hits R2 storage (slow, costs money at scale).

### Enable Cloudflare CDN for R2

1. In Cloudflare dashboard → R2 → your bucket
2. Settings → Custom Domains → Add domain
3. Add: images.kiwimart.co.nz (or your domain)
4. This automatically enables Cloudflare CDN caching

### Update getImageUrl() function

When CDN is enabled, update the base URL constant from:

```
https://[account].r2.cloudflarestorage.com/[bucket]/
```

to:

```
https://images.kiwimart.co.nz/
```

(find in src/lib/utils.ts or wherever getImageUrl is defined)

### Cache Configuration

In Cloudflare dashboard → Caching → Cache Rules:

- URL pattern: `images.kiwimart.co.nz/*`
- Cache TTL: 1 year (images are immutable — keyed by hash)
- Browser TTL: 1 year

### Expected Improvement

- Image load time: ~800ms → ~80ms (10x faster)
- R2 read costs: eliminated for cached images
- Vercel bandwidth: reduced (images served from Cloudflare edge)

## Load Testing

### Before Launch

Run load test to verify 500 concurrent user capacity:

Using k6 (free, open source):

```bash
k6 run --vus 100 --duration 30s loadtest/homepage.js
```

### Key Endpoints to Test

- `GET /` (homepage)
- `GET /listings/[id]` (listing detail)
- `GET /api/v1/search` (search)
- `POST /api/v1/auth/token` (auth)

### Acceptance Criteria

- p95 response time < 2000ms
- Error rate < 1%
- No database connection exhaustion

### Create loadtest/ directory

Create `loadtest/homepage.js` with a basic k6 script skeleton:

```javascript
// loadtest/homepage.js
// Run: k6 run --vus 100 --duration 30s loadtest/homepage.js

import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  vus: 100,
  duration: "30s",
  thresholds: {
    http_req_duration: ["p(95)<2000"],
    http_req_failed: ["rate<0.01"],
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

export default function () {
  // Homepage
  let res = http.get(`${BASE_URL}/`);
  check(res, { "homepage 200": (r) => r.status === 200 });

  sleep(1);

  // Search
  res = http.get(`${BASE_URL}/api/v1/search?q=bike&pageSize=20`);
  check(res, { "search 200": (r) => r.status === 200 });

  sleep(1);
}
```
