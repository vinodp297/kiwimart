# Database Reference

PostgreSQL via Prisma ORM. Hosted on Neon (serverless Postgres).

---

## Schema Overview

| Model                       | Description                                    | Growth   |
| --------------------------- | ---------------------------------------------- | -------- |
| `User`                      | Buyers and sellers; auth, profile, stripe data | Low      |
| `Listing`                   | For-sale items with full-text search vector    | Medium   |
| `Order`                     | Purchase lifecycle from payment to completion  | Medium   |
| `OrderEvent`                | Immutable state-machine audit trail per order  | **High** |
| `AuditLog`                  | Platform-wide admin/system action log          | **High** |
| `Notification`              | Per-user in-app notification feed              | Medium   |
| `Message` / `MessageThread` | Buyer–seller messaging                         | Medium   |
| `Review`                    | Post-completion buyer/seller reviews           | Low      |
| `Dispute`                   | Order dispute resolution workflow              | Low      |
| `Offer`                     | Buyer price offers on listings                 | Low      |
| `StripeEvent`               | Idempotency log for Stripe webhooks            | Medium   |
| `Payout`                    | Seller payout records                          | Low      |
| `AuditLog`                  | Full admin action trail                        | **High** |
| `PlatformConfig`            | Runtime feature flags and config values        | Very low |

---

## High-Growth Tables

### OrderEvent

Append-only event log for the order state machine. Every status transition, comment, and system action produces a row.

**Estimated growth:** ~5 events per order × orders per day.

**Partitioning plan (trigger: ~1M rows, est. 12–18 months at 1K DAU):**

```sql
-- Convert to partitioned table by month on createdAt
CREATE TABLE order_events_2026_01 PARTITION OF order_events
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');

-- Automate with pg_partman:
SELECT partman.create_parent(
  p_parent_table := 'public.order_events',
  p_control := 'created_at',
  p_type := 'range',
  p_interval := '1 month'
);
```

**Retention:** Archive partitions older than 12 months to cold storage (e.g. S3/R2 as JSONL).

**Index inherited by all partitions:** `(orderId, createdAt)` — already defined on the parent.

---

### AuditLog

Platform-wide immutable action log. Every admin action, auth event, and sensitive mutation writes here.

**Estimated growth:** ~10 audit rows per active user per day.

**Partitioning plan (trigger: ~5M rows, est. 6–12 months at 1K DAU):**

Same monthly partition pattern as `OrderEvent`. Use `pg_partman` for automated management.

**Retention:** Keep 24 months live. Archive remainder to cold storage.

**Indexes on parent (inherited by partitions):**

- `(userId)`
- `(action)`
- `(entityType, entityId)`
- `(createdAt)`
- `(action, createdAt)`

---

## Index Strategy

### Full-text search (`Listing.searchVector`)

`searchVector` is a `tsvector` column populated by a PostgreSQL trigger on insert/update of `title`, `description`, and `category`.

```sql
-- GIN index for fast full-text search
CREATE INDEX listings_search_vector_idx ON "Listing" USING GIN ("searchVector");
```

The `/api/health` endpoint monitors for active listings created in the last hour that are missing a `searchVector` — a sign the trigger has failed.

### Other performance indexes

| Table          | Index                       | Purpose             |
| -------------- | --------------------------- | ------------------- |
| `Listing`      | `(status, createdAt DESC)`  | Browse/feed queries |
| `Listing`      | `(sellerId, status)`        | Seller dashboard    |
| `Order`        | `(buyerId, status)`         | Buyer order list    |
| `Order`        | `(sellerId, status)`        | Seller order list   |
| `Order`        | `(status, createdAt)`       | Cron job queries    |
| `OrderEvent`   | `(orderId, createdAt)`      | Timeline queries    |
| `AuditLog`     | `(action, createdAt)`       | Admin audit filters |
| `Notification` | `(userId, read, createdAt)` | Unread count + feed |

---

## Migration Runbook

### Standard migration

```bash
# 1. Generate migration from schema changes
npx prisma migrate dev --name <descriptive-name>

# 2. Review generated SQL in prisma/migrations/
# 3. Apply to staging
DATABASE_URL=$STAGING_URL npx prisma migrate deploy

# 4. Verify — check row counts and spot-check data
# 5. Apply to production (zero-downtime for additive changes)
DATABASE_URL=$PROD_URL npx prisma migrate deploy
```

### Zero-downtime rules

- **Safe (no downtime):** `ADD COLUMN` with default, `CREATE INDEX CONCURRENTLY`, `ADD TABLE`
- **Requires care:** `DROP COLUMN` — deploy code that ignores the column first, then drop
- **Avoid:** `ALTER COLUMN` type changes on large tables — use a new column + backfill + swap
- **Never:** `DROP TABLE` without a full data export and stakeholder sign-off

### Adding a new partition (manual)

```sql
-- Run during low-traffic window
CREATE TABLE order_events_2026_06 PARTITION OF order_events
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
```

If using `pg_partman`, new partitions are created automatically via the `run_maintenance()` cron.

---

## Backup Strategy

### Neon built-in

Neon provides continuous WAL-based backups with point-in-time restore (PITR) to any second within the retention window (default: 7 days on paid plans).

**Restore procedure:**

1. Open Neon console → Branches → Create branch from point-in-time
2. Verify data on the restored branch
3. Promote branch or export data as needed

### Application-level exports

For compliance and long-term retention beyond Neon's PITR window:

```bash
# Full logical dump (run from a read replica or off-peak)
pg_dump $DATABASE_URL --format=custom --file=backup_$(date +%Y%m%d).pgdump

# Upload to R2/S3
rclone copy backup_$(date +%Y%m%d).pgdump r2:kiwi-backups/postgres/
```

**Recommended schedule:** Daily logical dump, retained for 90 days.

### High-growth table archival

Before dropping old partitions from `OrderEvent` and `AuditLog`, export to R2:

```bash
psql $DATABASE_URL -c "\COPY (SELECT * FROM order_events WHERE created_at < '2025-01-01') TO STDOUT (FORMAT csv)" \
  | gzip > order_events_pre_2025.csv.gz
# Upload to cold storage, then DROP the partition
```
