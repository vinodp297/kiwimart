# KiwiMart — Monitoring Setup

## Uptime Monitoring

We use Better Uptime (free tier) to monitor production endpoints.

### Monitors configured

| # | Endpoint | Interval | Alert condition |
|---|----------|----------|-----------------|
| 1 | `GET /api/ping` | 3 min | status ≠ 200 or response > 5s |
| 2 | `GET /api/health` | 3 min | status ≠ 200 or `"degraded"` in body |
| 3 | `GET /` (homepage) | 5 min | status ≠ 200 |

> **Use `/api/ping` for basic uptime checks** — it responds in < 10ms with no external calls.
> Use `/api/health` for detailed service-status checks (DB + Redis + Stripe).

### Setup instructions

1. Go to <https://betteruptime.com> and sign up (free)
2. Add each monitor above with the production URL
3. Configure email alerts for your address
4. Share the auto-generated status page URL with the team

### Alert channels

- Email: *(add your address here)*
- Slack: *(optional — add webhook URL in Better Uptime settings)*

---

## Log Aggregation

Vercel provides basic function logs at <https://vercel.com/dashboard>.

For searchable/alertable structured logs, integrate **Axiom** (free tier: 500 MB/day):

1. Sign up at <https://axiom.co>
2. Install the Vercel + Axiom integration
3. All structured JSON logs (from Pino) are automatically indexed
4. Useful queries:
   - `event:"payment.captured"` — all successful payments
   - `event:"payment.capture.failed"` — failed captures (alert on any)
   - `event:"order.dispute.opened"` — disputes
5. Set up an alert on `event:"payment.capture.failed"` for immediate notification

---

## Key Metrics to Monitor

| Metric | Tool | Alert threshold |
|--------|------|-----------------|
| Uptime | Better Uptime | < 99.9% |
| DB health | `/api/health` | any `error` status |
| Redis health | `/api/health` | any `error` status |
| Stripe health | `/api/health` | any `error` status |
| JS errors | Sentry | > 1% of requests |
| Payment failures | Sentry | any occurrence |
| Cron failures | Vercel logs | any `cron.*failed` event |

---

## Cron Jobs

| Job | Schedule | Route |
|-----|----------|-------|
| Auto-release escrow | 2:00 AM UTC daily | `/api/cron/auto-release` |
| Expire listings + offer reservations | 3:00 AM UTC daily | `/api/cron/expire-listings` |

All cron routes require `Authorization: Bearer $CRON_SECRET`.

---

## Worker Monitoring

| Check | URL | Expected |
|-------|-----|----------|
| Queue health | `GET /api/workers/health` | `{ "status": "ok" }` |
| Failed jobs | `npm run workers:check` | 0 failed jobs |

### Alerts to configure

- Alert if `/api/workers/health` returns `error` (queue unreachable)
- Alert if payout queue has > 5 failed jobs
- Alert if email queue has > 10 failed jobs

### Checking failed jobs manually

```bash
npm run workers:check
```

Exits with code 1 and prints details if any failed jobs exist.
