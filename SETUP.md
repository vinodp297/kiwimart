# KiwiMart Sprint 3 — Setup Guide
## Backend: Database · Auth · Payments · Email · Storage · Rate Limiting

---

## Prerequisites

- Sprint 1 & 2 installed and running (`npm run dev` working)
- Node.js 20+
- Accounts needed: Neon, Stripe (test mode), Postmark, Cloudflare (R2 + Turnstile), Upstash

---

## Step 1 — Install dependencies

```bash
npm install next-auth@beta @auth/prisma-adapter @prisma/client argon2 zod \
  stripe @upstash/ratelimit @upstash/redis postmark \
  @aws-sdk/client-s3 @aws-sdk/s3-request-presigner

npm install -D prisma tsx
```

---

## Step 2 — Copy Sprint 3 files

```bash
bash sprint3_install.sh
```

---

## Step 3 — Configure environment variables

```bash
cp .env.example .env.local
# Edit .env.local and fill in all values (see comments in the file)
```

### Minimum required for local dev:
| Variable | Where to get it |
|---|---|
| `DATABASE_URL` | Neon console → Connection Details |
| `DATABASE_DIRECT_URL` | Same, direct (non-pooled) URL |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` |
| `POSTMARK_SERVER_TOKEN` | Postmark → Server → API Tokens |
| `STRIPE_SECRET_KEY` | Stripe dashboard → Test mode keys |
| `STRIPE_WEBHOOK_SECRET` | `stripe listen --forward-to localhost:3000/api/webhooks/stripe` |
| `UPSTASH_REDIS_REST_URL` | Upstash console → REST API |
| `UPSTASH_REDIS_REST_TOKEN` | Same |

For local dev, Cloudflare Turnstile and R2 can use the test values already in `.env.example`.

---

## Step 4 — Set up the database

```bash
# Generate Prisma client
npm run db:generate

# Push schema to Neon (creates all tables)
npm run db:push

# Seed categories and test users
npm run db:seed
```

Test users created:
- `admin@kiwimart.test` / `AdminPassword123!`
- `buyer@kiwimart.test` / `BuyerPassword123!`
- `seller@kiwimart.test` / `SellerPassword123!`

---

## Step 5 — Set up Stripe webhooks (local)

In a separate terminal:
```bash
# Install Stripe CLI: https://stripe.com/docs/stripe-cli
stripe listen --forward-to localhost:3000/api/webhooks/stripe
# Copy the webhook signing secret into STRIPE_WEBHOOK_SECRET in .env.local
```

---

## Step 6 — Add prisma section to package.json

In your `package.json`, add:
```json
{
  "prisma": {
    "seed": "tsx prisma/seed.ts"
  },
  "scripts": {
    "db:push": "prisma db push",
    "db:migrate": "prisma migrate dev",
    "db:seed": "prisma db seed",
    "db:studio": "prisma studio",
    "db:generate": "prisma generate"
  }
}
```

---

## Step 7 — Run dev server

```bash
npm run dev
```

Test auth at:
- `http://localhost:3000/login`
- `http://localhost:3000/register`
- `http://localhost:3000/dashboard/buyer` (requires login → redirects to /login)

---

## Full-text search Postgres trigger (run after db:push)

Connect to your Neon database and run:

```sql
-- Create search vector column and trigger for full-text search
ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "searchVector" tsvector;

CREATE OR REPLACE FUNCTION listing_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW."searchVector" :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.suburb, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW.region, '')), 'C');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS listing_search_vector_update ON "Listing";
CREATE TRIGGER listing_search_vector_update
  BEFORE INSERT OR UPDATE ON "Listing"
  FOR EACH ROW EXECUTE FUNCTION listing_search_vector_update();

-- Backfill existing rows
UPDATE "Listing" SET title = title;

-- Create GIN index
CREATE INDEX IF NOT EXISTS listing_search_idx ON "Listing" USING GIN ("searchVector");
```

---

## Architecture overview

```
Browser
  │
  ├── GET /login            → (auth) layout → login/page.tsx (client)
  │     └── form submit     → signIn('credentials') → Auth.js
  │                              └── authorize() → verifyPassword (Argon2id)
  │                                              → Turnstile verify
  │                                              → AuditLog write
  │
  ├── POST /register        → registerUser() server action
  │     └── 7-step pattern: authenticate → validate (Zod) → rate limit (Redis)
  │                        → hashPassword (Argon2id) → db.user.create
  │                        → sendWelcomeEmail (Postmark) → audit log
  │
  ├── POST /sell            → createListing() server action
  │     └── auth → authorise → validate → rate limit → db.listing.create
  │             → revalidatePath('/search')
  │
  ├── Stripe Checkout       → createOrder() → stripe.paymentIntents.create
  │     └── webhook         → POST /api/webhooks/stripe → verify sig → update DB
  │
  └── All pages             → middleware.ts (Edge)
        └── getToken() → auth check → redirect or security headers
```

---

## What's NOT done yet (Sprint 4)

- [ ] Real Cloudflare R2 image upload (currently mock presigned URLs)
- [ ] ClamAV malware scanning (currently auto-marked safe)
- [ ] Pusher real-time messaging
- [ ] BullMQ job queue (payout processing, email queuing)
- [ ] Stripe Connect onboarding flow UI
- [ ] NZ Post shipping API integration
- [ ] Admin dashboard
- [ ] Seller ID verification (Stripe Identity or Veriff)

