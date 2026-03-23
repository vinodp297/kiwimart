# KiwiMart — Deployment Guide

## Prerequisites

- Vercel account (vercel.com)
- GitHub repo: vinodp297/kiwimart
- All service accounts set up (see `.env.production.example`)

## Step 1 — Deploy to Vercel

1. Go to vercel.com/new
2. Import GitHub repo: `vinodp297/kiwimart`
3. Framework: Next.js (auto-detected)
4. Root directory: `./`
5. Set all environment variables from `.env.production.example`
6. Click **Deploy**

## Step 2 — Database setup

After first deploy:

```bash
npx prisma migrate deploy
npx prisma db seed   # categories only
```

## Step 3 — Custom domain

1. Vercel Dashboard → Settings → Domains
2. Add: `kiwimart.co.nz`
3. Add: `www.kiwimart.co.nz`
4. Update DNS at your domain registrar (Vercel provides the records)

## Step 4 — Stripe live mode

1. Switch to live keys in Vercel environment variables
2. Set up live webhook endpoint in Stripe Dashboard:
   `https://kiwimart.co.nz/api/webhooks/stripe`
3. Events to subscribe: `payment_intent.succeeded`, `payment_intent.payment_failed`, `account.updated`
4. Enable Afterpay/Clearpay in Stripe Dashboard for NZ

## Step 5 — Verify production

```bash
curl https://kiwimart.co.nz/api/health
# Expected: { "status": "ok", "database": "connected" }

curl https://kiwimart.co.nz/sitemap.xml
# Expected: Valid XML sitemap

curl https://kiwimart.co.nz/robots.txt
# Expected: Disallow rules for /admin, /dashboard, etc.
```

## Step 6 — Go live checklist

- [ ] `NEXTAUTH_URL` set to production domain
- [ ] `NEXT_PUBLIC_APP_URL` set to production domain
- [ ] Stripe **live** keys active (not test keys)
- [ ] Webhook endpoint verified in Stripe dashboard
- [ ] `STRIPE_WEBHOOK_SECRET` updated with live webhook secret
- [ ] Database has real categories seeded
- [ ] Admin account password changed from default
- [ ] Sentry DSN configured for error monitoring
- [ ] PostHog key configured for analytics
- [ ] Cloudflare R2 bucket has public access configured
- [ ] Postmark domain verified for email sending

## Monitoring

| Service     | URL                              |
|-------------|----------------------------------|
| Health      | https://kiwimart.co.nz/api/health |
| Errors      | sentry.io dashboard              |
| Analytics   | posthog.com dashboard            |
| Database    | console.neon.tech                |
| Payments    | dashboard.stripe.com             |
| Email       | account.postmarkapp.com          |
| Storage     | dash.cloudflare.com (R2)         |

## Rolling back

```bash
# Revert to previous Vercel deployment
vercel rollback

# Or via Vercel dashboard: Deployments → Previous → Promote to Production
```
