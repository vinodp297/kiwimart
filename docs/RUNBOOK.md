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

## Monitoring Checklist (Daily)

- [ ] Sentry error rate < 0.1%
- [ ] Health endpoint returning 200
- [ ] Vercel function execution times < 8s
- [ ] Neon compute hours < 80% of plan limit
- [ ] Upstash commands < 80% of daily limit
