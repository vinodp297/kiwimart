# Buyzi — NZ Peer-to-Peer Marketplace

![Coverage](https://img.shields.io/badge/coverage-46%25-green)
![Tests](https://img.shields.io/badge/tests-1725%20passing-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)
![Security](https://img.shields.io/badge/security-97%2F100-brightgreen)

## What Is This

Buyzi is a peer-to-peer marketplace built for New Zealand buyers and sellers. It provides a full-featured platform for listing, discovering, negotiating, and transacting secondhand goods — with Stripe escrow payments, real-time messaging, trust scoring, dispute resolution, and a mobile-ready REST API. Unlike Trade Me, Buyzi uses a modern escrow-first payment model where funds are held until the buyer confirms delivery, eliminating the risk of non-delivery fraud.

## Tech Stack

| Technology          | Purpose                                     | Version                          |
| ------------------- | ------------------------------------------- | -------------------------------- |
| Next.js             | Full-stack React framework (App Router)     | 16.2.1                           |
| React               | UI library                                  | 19.2.4                           |
| TypeScript          | Type-safe JavaScript                        | ^5                               |
| Prisma              | ORM and database toolkit                    | ^7.5.0                           |
| Neon PostgreSQL     | Serverless PostgreSQL database              | —                                |
| Auth.js (next-auth) | Authentication (credentials + Google OAuth) | ^5.0.0-beta.30                   |
| Stripe              | Payments, escrow, Connect payouts           | ^20.4.1                          |
| Cloudflare R2       | Image and file storage (S3-compatible)      | via @aws-sdk/client-s3 ^3.1014.0 |
| BullMQ              | Background job queue                        | ^5.71.0                          |
| IORedis             | Redis client for BullMQ workers             | ^5.10.1                          |
| Upstash Redis       | Rate limiting, caching, distributed locks   | ^1.37.0                          |
| Pusher              | Real-time messaging and notifications       | ^5.3.3                           |
| Resend              | Transactional email delivery                | ^6.9.4                           |
| Twilio              | SMS verification and pickup OTP             | ^5.13.1                          |
| Argon2              | Password hashing (OWASP 2024 params)        | ^0.44.0                          |
| Jose                | JWT signing and verification (mobile API)   | ^6.2.2                           |
| Zod                 | Runtime schema validation                   | ^4.3.6                           |
| Sharp               | Server-side image processing and resizing   | ^0.34.5                          |
| Sentry              | Error monitoring and alerting               | ^10.45.0                         |
| PostHog             | Product analytics and event tracking        | ^1.363.1                         |
| Recharts            | Dashboard charts and data visualisation     | ^3.8.1                           |
| Tailwind CSS        | Utility-first CSS framework                 | ^4                               |
| Vitest              | Unit and integration testing                | ^4.1.1                           |
| Playwright          | End-to-end browser testing                  | ^1.58.2                          |

## Architecture Overview

The codebase follows a **4-layer architecture** with strict dependency rules:

### `app/` — Routing Only

Next.js App Router pages and API routes. Contains zero business logic — pages call server actions or render components, API routes delegate to services. Route groups: `(auth)` for login/register, `(protected)` for authenticated pages, `(public)` for listings and search.

### `modules/` — Vertical Feature Slices

Each module is a self-contained domain with up to four files:

- `*.repository.ts` — Database queries (Prisma). Only file that imports `db`.
- `*.service.ts` — Business logic. Orchestrates repositories, enforces rules.
- `*.schema.ts` — Zod validation schemas for input.
- `*.types.ts` — TypeScript types and interfaces for the domain.

Modules: `admin`, `auth`, `cart`, `dashboard`, `disputes`, `listings`, `messaging`, `notifications`, `offers`, `orders`, `payments`, `pickup`, `reviews`, `sellers`, `trust`, `users`.

### `server/actions/` — Server Actions (Thin Orchestration)

Next.js `"use server"` functions that serve as the web client's entry point. Each action: validates input with Zod, calls `requireUser()` for auth, delegates to the appropriate service, returns `ActionResult<T>`. ~44 action files covering every user-facing operation.

### `components/` — UI Only

React components with zero business logic. Organised into: `ui/` (generic), `admin/`, `seller/`, `onboarding/`, `pickup/`.

### `infrastructure/` — External Service Clients

Thin wrappers around third-party SDKs. One file per service: `stripe/client.ts`, `storage/r2.ts`, `email/client.ts`, `queue/client.ts`, `redis/client.ts`, `config/env.ts` (Zod-validated environment).

### `shared/` — Cross-Cutting Concerns

Auth guards (`requireUser`, `requireAdmin`, `requirePermission`), structured error types (`AppError`), logger (JSON in prod, pretty in dev with Sentry forwarding), and shared TypeScript types.

## Key Design Patterns

| Pattern                    | Description                                                                                                   | Example File                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Repository Pattern**     | All DB access goes through `*.repository.ts` files — services never import Prisma directly                    | `src/modules/orders/order.repository.ts`                            |
| **Service Layer**          | Business logic lives in `*.service.ts`, orchestrating repositories and enforcing domain rules                 | `src/modules/orders/order.service.ts`                               |
| **State Machine**          | Order lifecycle transitions enforced via a whitelist map; invalid transitions throw                           | `src/modules/orders/order.transitions.ts`                           |
| **Distributed Locking**    | Redis `SET NX EX` locks prevent concurrent offer acceptance on the same listing                               | `src/server/lib/distributedLock.ts`                                 |
| **Event Sourcing (light)** | Append-only `OrderEvent` audit trail records every state change with actor and metadata                       | `src/modules/orders/order-event.service.ts`                         |
| **Factory Methods**        | `AppError.notFound()`, `AppError.rateLimited()`, `apiOk()`, `apiError()` for consistent error/response shapes | `src/shared/errors/index.ts`, `src/app/api/v1/_helpers/response.ts` |
| **Dual Auth**              | Server actions use session cookies; `/api/v1/` routes accept both Bearer JWT and session cookies              | `src/app/api/v1/_helpers/response.ts`                               |
| **Optimistic Locking**     | `transitionOrder` uses `updateMany WHERE status = current` to detect race conditions                          | `src/modules/orders/order.transitions.ts`                           |

## Project Structure

```
src/
├── app/                    # Next.js App Router — pages, layouts, API routes
│   ├── (auth)/             # Login, register, forgot password
│   ├── (protected)/        # Authenticated pages (dashboard, orders, messages, settings)
│   ├── (public)/           # Public pages (listings, search, seller profiles)
│   └── api/                # API routes (v1/, cron/, webhooks/, admin/)
├── components/             # React UI components
│   ├── admin/              # Admin panel components
│   ├── onboarding/         # Seller onboarding flow
│   ├── pickup/             # In-person pickup UI
│   ├── seller/             # Seller dashboard components
│   └── ui/                 # Shared UI primitives
├── data/                   # Static data files (categories, regions)
├── hooks/                  # React custom hooks
├── infrastructure/         # External service clients
│   ├── config/             # Zod env validation
│   ├── email/              # Resend client
│   ├── queue/              # BullMQ/IORedis connection
│   ├── redis/              # IORedis client
│   ├── storage/            # Cloudflare R2 (S3) client
│   └── stripe/             # Stripe client
├── lib/                    # Shared utilities and configuration
│   ├── auth.ts             # Auth.js v5 config (JWT, providers, callbacks)
│   ├── db.ts               # Prisma client singleton
│   ├── encryption.ts       # Field-level AES encryption (phone numbers)
│   ├── mobile-auth.ts      # JWT issuing/verification for mobile API
│   └── pusher.ts           # Pusher server + browser clients
├── modules/                # Domain feature slices (16 modules)
│   ├── admin/              # Admin operations, moderation
│   ├── auth/               # Auth schemas, MFA/TOTP
│   ├── cart/               # Shopping cart
│   ├── dashboard/          # Seller/buyer dashboard analytics
│   ├── disputes/           # Dispute handling, auto-resolution
│   ├── listings/           # Listings CRUD, search, recommendations
│   ├── messaging/          # Real-time buyer-seller chat
│   ├── notifications/      # In-app notification system
│   ├── offers/             # Price negotiation with distributed locks
│   ├── orders/             # Order lifecycle, state machine, events
│   ├── payments/           # Stripe payments, escrow, webhooks
│   ├── pickup/             # In-person pickup scheduling
│   ├── reviews/            # Two-way review system
│   ├── sellers/            # Seller profiles, trust scoring, tiers
│   ├── trust/              # Trust metrics calculation
│   └── users/              # User management, auth service
├── server/                 # Server-side logic
│   ├── actions/            # Next.js server actions (~44 files)
│   ├── email/              # Email templates
│   ├── jobs/               # Cron job implementations (10 jobs)
│   ├── lib/                # Auth guards, rate limiting, crypto, audit
│   ├── services/           # Legacy service files
│   ├── validators/         # Shared Zod validators
│   └── workers/            # BullMQ worker implementations (4 workers)
├── shared/                 # Cross-cutting concerns
│   ├── auth/               # Auth guard re-exports
│   ├── errors/             # AppError class and error codes
│   ├── logger/             # Structured logger (JSON prod, pretty dev)
│   └── types/              # ActionResult<T> and shared types
├── test/                   # Test files
├── types/                  # Global TypeScript declarations
└── proxy.ts                # Dev proxy utilities
```

## Local Development Setup

### Prerequisites

- **Node.js** >= 18 (LTS recommended)
- **npm** (included with Node.js)
- A PostgreSQL database (local or [Neon](https://neon.tech) free tier)
- Redis instance (local or [Upstash](https://upstash.com) free tier) for rate limiting and locks

### 1. Clone and Install

```bash
git clone <repository-url>
cd kiwi-project
npm install
```

This runs `prisma generate` automatically via the `postinstall` hook.

### 2. Environment Variables

```bash
cp .env.example .env
```

Fill in the required values. See the [Environment Variables](#environment-variables) section below for a full breakdown. At minimum you need:

- `DATABASE_URL` and `DATABASE_DIRECT_URL` — Neon connection strings
- `NEXTAUTH_SECRET` — run `openssl rand -base64 32` to generate
- `NEXTAUTH_URL` — `http://localhost:3000` for local dev

### 3. Database Setup

```bash
# Apply all migrations
npm run db:migrate

# Seed with sample data
npm run db:seed

# (Optional) Open Prisma Studio to browse data
npm run db:studio
```

### 4. Start Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 5. Start BullMQ Workers (Optional)

If you need background job processing (emails, image processing, payouts, pickup scheduling):

```bash
npm run worker:dev
```

This requires a `REDIS_URL` environment variable pointing to a Redis instance.

### 6. Verify Environment

```bash
npm run check-env
```

This validates all required environment variables are set.

## Environment Variables

All variables are defined in `.env.example`. The `infrastructure/config/env.ts` file validates them at build time with Zod.

### App Identity

| Variable                    | Description                                  |
| --------------------------- | -------------------------------------------- |
| `NEXT_PUBLIC_APP_URL`       | Public base URL (e.g. `https://buyzi.co.nz`) |
| `NEXT_PUBLIC_APP_NAME`      | Display name (`Buyzi`)                       |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | Support contact email                        |

### Database

| Variable              | Description                                  |
| --------------------- | -------------------------------------------- |
| `DATABASE_URL`        | Prisma Accelerate pooled connection string   |
| `DATABASE_DIRECT_URL` | Direct Neon connection (used for migrations) |

### Authentication

| Variable               | Description                        |
| ---------------------- | ---------------------------------- |
| `NEXTAUTH_SECRET`      | JWT signing secret                 |
| `NEXTAUTH_URL`         | App base URL for Auth.js callbacks |
| `GOOGLE_CLIENT_ID`     | Google OAuth client ID             |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret         |

### Bot Protection (Cloudflare Turnstile)

| Variable                          | Description                            |
| --------------------------------- | -------------------------------------- |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`  | Client-side site key (bypassed in dev) |
| `CLOUDFLARE_TURNSTILE_SECRET_KEY` | Server-side verification key           |

### Payments (Stripe)

| Variable                             | Description                   |
| ------------------------------------ | ----------------------------- |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe publishable key        |
| `STRIPE_SECRET_KEY`                  | Stripe secret key             |
| `STRIPE_WEBHOOK_SECRET`              | Stripe webhook signing secret |
| `STRIPE_CONNECT_CLIENT_ID`           | Stripe Connect platform ID    |

### Storage (Cloudflare R2)

| Variable                    | Description               |
| --------------------------- | ------------------------- |
| `CLOUDFLARE_ACCOUNT_ID`     | Cloudflare account ID     |
| `R2_BUCKET_NAME`            | R2 bucket name            |
| `R2_ACCESS_KEY_ID`          | R2 access key             |
| `R2_SECRET_ACCESS_KEY`      | R2 secret key             |
| `NEXT_PUBLIC_R2_PUBLIC_URL` | Public CDN URL for images |

### Email

| Variable         | Description    |
| ---------------- | -------------- |
| `RESEND_API_KEY` | Resend API key |
| `EMAIL_FROM`     | Sender address |

### SMS (Twilio)

| Variable             | Description         |
| -------------------- | ------------------- |
| `TWILIO_ACCOUNT_SID` | Twilio account SID  |
| `TWILIO_AUTH_TOKEN`  | Twilio auth token   |
| `TWILIO_FROM_NUMBER` | Sender phone number |

### Real-Time (Pusher)

| Variable                                        | Description           |
| ----------------------------------------------- | --------------------- |
| `PUSHER_APP_ID`                                 | Pusher app ID         |
| `PUSHER_KEY` / `NEXT_PUBLIC_PUSHER_KEY`         | Pusher key            |
| `PUSHER_SECRET`                                 | Pusher secret         |
| `PUSHER_CLUSTER` / `NEXT_PUBLIC_PUSHER_CLUSTER` | Pusher cluster region |

### Queue & Cache (Redis)

| Variable                   | Description                                          |
| -------------------------- | ---------------------------------------------------- |
| `REDIS_URL`                | IORedis connection URL (for BullMQ workers)          |
| `UPSTASH_REDIS_REST_URL`   | Upstash Redis REST URL (rate limiting, locks, cache) |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token                             |

### Security

| Variable         | Description                                                |
| ---------------- | ---------------------------------------------------------- |
| `ENCRYPTION_KEY` | 64-char hex key for field-level encryption (phone numbers) |
| `CRON_SECRET`    | Bearer token for cron job authentication                   |
| `WORKER_SECRET`  | Bearer token for worker health endpoints                   |

### Monitoring

| Variable                   | Description                   |
| -------------------------- | ----------------------------- |
| `NEXT_PUBLIC_SENTRY_DSN`   | Sentry DSN for error tracking |
| `NEXT_PUBLIC_POSTHOG_KEY`  | PostHog project API key       |
| `NEXT_PUBLIC_POSTHOG_HOST` | PostHog instance URL          |

## Background Jobs

### Vercel Cron Jobs (Serverless)

These run on Vercel's cron scheduler. Each is a Next.js API route protected by `CRON_SECRET` Bearer token verification.

| Job                     | Schedule                     | Description                                                                                                                        |
| ----------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `auto-release`          | `0 2 * * *` (2 AM daily)     | Captures Stripe escrow and completes orders where the buyer hasn't confirmed delivery after N business days                        |
| `dispute-auto-resolve`  | `0 3 * * *` (3 AM daily)     | Auto-resolves disputes where the seller hasn't responded, processes cooling-period completions, and escalates expired interactions |
| `expire-listings`       | `30 3 * * *` (3:30 AM daily) | Marks expired listings as `EXPIRED` and releases reservations from expired offers                                                  |
| `delivery-reminders`    | `0 4 * * *` (4 AM daily)     | Sends escalating delivery confirmation reminders to buyers; auto-completes very overdue orders                                     |
| `seller-downgrade`      | `0 6 * * *` (6 AM daily)     | Downgrades seller tier (Gold → Silver → Bronze) when trust metrics fall below thresholds                                           |
| `daily-digest`          | `0 7 * * *` (7 AM daily)     | Sends an HTML email summary of platform metrics to all super admins                                                                |
| `stripe-reconciliation` | `0 14 * * *` (2 PM daily)    | Log-only reconciliation — flags mismatches between Stripe payment intents and DB order states                                      |
| `price-drop-alerts`     | _(not yet scheduled)_        | Notifies watchlist users when a watched listing's price drops below their alert threshold                                          |

### BullMQ Workers (Persistent Process)

These run as a separate long-lived process (`npm run worker`) on Render.com. They process four queues:

| Queue    | Worker       | Concurrency | Description                                                                                                         |
| -------- | ------------ | ----------- | ------------------------------------------------------------------------------------------------------------------- |
| `email`  | emailWorker  | 5           | Sends transactional emails (welcome, password reset, offer notifications, dispatch/completion, disputes) via Resend |
| `image`  | imageWorker  | 3           | Downloads from R2, scans, resizes (1200px full + 480px thumb), converts to WebP, strips EXIF, re-uploads            |
| `payout` | payoutWorker | 2           | Initiates Stripe Connect transfers to sellers, updates payout status, sends confirmation email                      |
| `pickup` | pickupWorker | 2           | Manages pickup lifecycle timeouts: schedule deadlines, window expiry, OTP expiry, reschedule expiry                 |

## API Overview

### Base URL

```
/api/v1/
```

### Authentication

The API supports dual authentication:

- **Bearer Token** (mobile clients): `Authorization: Bearer <jwt>` — obtain via `POST /api/v1/auth/token`
- **Session Cookie** (web clients): Automatic via Auth.js session cookies

### Response Envelope

All responses follow a consistent envelope:

```json
// Success
{ "success": true, "data": { ... }, "timestamp": "2026-04-04T00:00:00.000Z" }

// Error
{ "success": false, "error": "Human-readable message", "code": "ERROR_CODE", "timestamp": "2026-04-04T00:00:00.000Z" }
```

### Pagination

All list endpoints use **cursor-based pagination**:

```
GET /api/v1/listings?cursor=<last-item-id>&limit=20
```

Response includes a `nextCursor` field when more items exist.

### Endpoints

#### Auth

| Method | Path            | Description                  |
| ------ | --------------- | ---------------------------- |
| POST   | `/auth/token`   | Issue JWT (email + password) |
| POST   | `/auth/refresh` | Refresh an expired JWT       |

#### Account

| Method | Path        | Description              |
| ------ | ----------- | ------------------------ |
| GET    | `/account`  | Get current user profile |
| GET    | `/users/me` | Get current user (alias) |

#### Listings

| Method | Path                   | Description          |
| ------ | ---------------------- | -------------------- |
| GET    | `/listings`            | List/filter listings |
| POST   | `/listings`            | Create a new listing |
| GET    | `/listings/[id]`       | Get listing details  |
| PATCH  | `/listings/[id]`       | Update a listing     |
| POST   | `/listings/[id]/watch` | Toggle watchlist     |

#### Search

| Method | Path      | Description                           |
| ------ | --------- | ------------------------------------- |
| GET    | `/search` | Full-text listing search with filters |

#### Cart

| Method | Path    | Description                  |
| ------ | ------- | ---------------------------- |
| GET    | `/cart` | Get cart contents            |
| POST   | `/cart` | Add/update/remove cart items |

#### Orders

| Method | Path      | Description                |
| ------ | --------- | -------------------------- |
| GET    | `/orders` | List user's orders         |
| POST   | `/orders` | Create an order (checkout) |

#### Offers

| Method | Path           | Description                    |
| ------ | -------------- | ------------------------------ |
| GET    | `/offers`      | List user's offers             |
| POST   | `/offers`      | Make an offer on a listing     |
| GET    | `/offers/[id]` | Get offer details              |
| PATCH  | `/offers/[id]` | Accept/reject/counter an offer |

#### Pickup

| Method | Path                         | Description                      |
| ------ | ---------------------------- | -------------------------------- |
| POST   | `/pickup/propose`            | Propose pickup time and location |
| POST   | `/pickup/accept`             | Accept a pickup proposal         |
| POST   | `/pickup/cancel`             | Cancel a pickup                  |
| POST   | `/pickup/reschedule`         | Request reschedule               |
| POST   | `/pickup/reschedule/respond` | Accept/reject reschedule         |

#### Messaging

| Method | Path        | Description                     |
| ------ | ----------- | ------------------------------- |
| GET    | `/messages` | List conversations and messages |
| POST   | `/messages` | Send a message                  |

#### Reviews

| Method | Path       | Description     |
| ------ | ---------- | --------------- |
| GET    | `/reviews` | List reviews    |
| POST   | `/reviews` | Submit a review |

#### Notifications

| Method | Path             | Description        |
| ------ | ---------------- | ------------------ |
| GET    | `/notifications` | List notifications |
| PATCH  | `/notifications` | Mark as read       |

## Deployment

### Vercel (Web Application)

1. Connect your GitHub repository to Vercel
2. Set all environment variables from `.env.example`
3. Build command: `npm run build` (automatically runs `prisma generate`)
4. Install command: `npm install`
5. Framework preset: Next.js
6. Region: `sfo1` (configured in `vercel.json`)

### Database Migrations

Run on every deploy:

```bash
npx prisma migrate deploy
```

### BullMQ Workers (Render.com)

Deploy `src/server/workers/index.ts` as a separate persistent process via `render.yaml`:

1. Create a Render.com **Background Worker** service and connect your GitHub repository
2. Render detects `render.yaml` automatically — start command is `npm run worker`
3. Set the required environment variables in the Render dashboard
4. The process runs all 4 workers (email, image, payout, pickup) in a single Node.js process

### Cron Jobs

Configured in `vercel.json`. Vercel automatically calls each endpoint on schedule. All routes require `CRON_SECRET` as a Bearer token — Vercel injects this automatically for its own cron invocations.
