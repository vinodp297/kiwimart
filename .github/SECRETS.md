# GitHub Secrets Required

Add these secrets in GitHub repository settings:
**Settings → Secrets and variables → Actions → New repository secret**

---

## Required for CI (tests + build)

| Secret | Description |
|--------|-------------|
| `DATABASE_URL` | Neon pooled connection string (Prisma Accelerate or direct) |
| `DATABASE_DIRECT_URL` | Neon direct connection string (for migrations) |
| `NEXTAUTH_SECRET` | Auth.js secret — generate: `openssl rand -base64 32` |
| `NEXTAUTH_URL` | Production URL e.g. `https://kiwimart.vercel.app` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe `pk_test_` or `pk_live_` key |
| `STRIPE_SECRET_KEY` | Stripe `sk_test_` or `sk_live_` key |
| `STRIPE_WEBHOOK_SECRET` | Stripe `whsec_` webhook signing secret |
| `PUSHER_APP_ID` | Pusher app ID |
| `PUSHER_KEY` | Pusher key |
| `PUSHER_SECRET` | Pusher secret |
| `PUSHER_CLUSTER` | Pusher cluster e.g. `ap4` |
| `NEXT_PUBLIC_PUSHER_KEY` | Pusher public key (same as `PUSHER_KEY`) |
| `NEXT_PUBLIC_PUSHER_CLUSTER` | Pusher cluster (same as `PUSHER_CLUSTER`) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |
| `R2_BUCKET_NAME` | R2 bucket name e.g. `kiwimart-listings` |
| `R2_ACCESS_KEY_ID` | R2 access key ID |
| `R2_SECRET_ACCESS_KEY` | R2 secret access key |
| `NEXT_PUBLIC_R2_PUBLIC_URL` | R2 public URL e.g. `https://r2.kiwimart.co.nz` |
| `UPSTASH_REDIS_REST_URL` | Upstash REST URL e.g. `https://xxx.upstash.io` |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash REST token |
| `REDIS_URL` | IORedis TCP URL for BullMQ e.g. `redis://...` |
| `RESEND_API_KEY` | Resend API key e.g. `re_...` |
| `EMAIL_FROM` | Sender address e.g. `KiwiMart <noreply@kiwimart.co.nz>` |
| `CRON_SECRET` | Secret for `/api/cron/*` endpoints (32+ chars) |
| `WORKER_SECRET` | Secret for `/api/workers` endpoint (32+ chars) |

---

## Required for deployment only

| Secret | Description |
|--------|-------------|
| `VERCEL_TOKEN` | Vercel deployment token — get from vercel.com → Account Settings → Tokens |

---

## How to add secrets

1. Go to [github.com/vinodp297/kiwimart/settings/secrets/actions](https://github.com/vinodp297/kiwimart/settings/secrets/actions)
2. Click **New repository secret**
3. Add each secret from the tables above
4. Get values from your `.env.local` file

## Vercel Token

The Vercel token for this project is stored in `.env.local`.
Add it as `VERCEL_TOKEN` in GitHub secrets.

## Notes

- `DATABASE_URL` in CI uses the real Neon database for build (static page generation requires DB).
- Tests use stub/placeholder values for most secrets — only `DATABASE_URL` needs to be real for the Prisma generate step.
- Never commit `.env.local` or any file containing real secrets to git.
