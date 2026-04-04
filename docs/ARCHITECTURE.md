# Architecture Decision Records

## ADR-001: Repository Pattern

**Decision:** All database access goes through `*.repository.ts` files. Services never import `db` (the Prisma client) directly.

**Context:** The platform was designed from the start to support both a Next.js web frontend (via server actions) and a React Native mobile app (via REST API). Centralising data access in repositories means both entry points share the same query logic, and repositories can be mocked independently in unit tests.

**Consequences:**

- More files per module (service + repository minimum), but each file has a single responsibility.
- Queries are testable in isolation without spinning up a full Next.js server.
- Repository methods accept `tx?: Prisma.TransactionClient` parameters so services can compose multiple repository calls into a single database transaction.

**Example:** `src/modules/orders/order.repository.ts`

---

## ADR-002: Server Actions + API Routes Dual Layer

**Decision:** The web app uses Next.js Server Actions (`"use server"` functions in `src/server/actions/`). A parallel REST API under `/api/v1/` serves mobile clients.

**Context:** Next.js Server Actions provide excellent DX for the web client (direct function calls, automatic form handling, streaming). However, they cannot be called from React Native — mobile apps need traditional HTTP endpoints. Rather than choosing one or the other, both layers delegate to the same service/repository layer.

**Consequences:**

- Some structural duplication between actions and API routes (both validate input, call auth, delegate to services).
- Mobile-ready from day one without retrofitting.
- The `_helpers/response.ts` file provides `requireApiUser()` with dual auth: Bearer JWT for mobile, session cookie fallback for web.

**Example:** Compare `src/server/actions/orders.ts` with `src/app/api/v1/orders/route.ts` — both call `orderService`.

---

## ADR-003: Integer Cents for Money

**Decision:** All monetary values are stored as integer cents (NZD). The Prisma schema uses `Int` for price fields (e.g., `priceNzd`, `offerAmountNzd`).

**Context:** Floating-point arithmetic introduces rounding errors that are unacceptable for financial calculations. Storing cents as integers eliminates this class of bugs entirely. The NZ marketplace only handles NZD, so multi-currency is not a concern.

**Consequences:**

- Every price in the database is in cents (e.g., `5000` = $50.00 NZD).
- UI components must divide by 100 for display and multiply by 100 on input.
- Stripe expects amounts in cents natively, so no conversion needed at the payment layer.

---

## ADR-004: State Machine for Orders

**Decision:** Order status transitions are enforced via an explicit whitelist map in `order.transitions.ts`. The `transitionOrder()` function validates the transition, then applies it with optimistic locking.

**Context:** Marketplace orders have a complex lifecycle: payment hold → dispatch → delivery → completion, with dispute and cancellation branches. Incorrect transitions have legal and financial implications (e.g., releasing escrow prematurely). A state machine makes invalid transitions impossible rather than merely unlikely.

**Consequences:**

- No ad-hoc `order.update({ status: ... })` calls anywhere in the codebase.
- All transitions go through `transitionOrder()` which uses `updateMany WHERE status = currentStatus` for optimistic locking — if another process already moved the order, the update affects 0 rows and throws.
- Every transition is logged via `orderEventService.recordEvent()`.

**Valid transitions:**

```
AWAITING_PAYMENT → PAYMENT_HELD, AWAITING_PICKUP, CANCELLED
PAYMENT_HELD     → DISPATCHED, CANCELLED, DISPUTED
AWAITING_PICKUP  → COMPLETED, CANCELLED, DISPUTED
DISPATCHED       → DELIVERED, DISPUTED, COMPLETED
DELIVERED        → COMPLETED, DISPUTED
DISPUTED         → COMPLETED, REFUNDED, CANCELLED
COMPLETED        → (terminal)
REFUNDED         → (terminal)
CANCELLED        → (terminal)
```

**Example:** `src/modules/orders/order.transitions.ts`

---

## ADR-005: Argon2id for Passwords

**Decision:** Passwords are hashed with Argon2id using OWASP 2024 recommended parameters: 64 MB memory, 3 iterations, parallelism 1, 32-byte output.

**Context:** bcrypt is showing its age (limited to 72-byte passwords, fixed memory cost). scrypt has poor JavaScript library support. Argon2id is the current OWASP recommendation and provides both GPU and side-channel resistance. The `argon2` npm package provides native bindings for performance.

**Consequences:**

- Login hashing takes ~300ms — acceptable for a security-critical operation.
- `needsRehash()` function enables transparent parameter upgrades on next login.
- Requires native compilation (`argon2` package), which works on Vercel but may need attention on other platforms.

**Example:** `src/server/lib/password.ts`

---

## ADR-006: Cursor Pagination

**Decision:** All list endpoints (both server actions and API routes) use cursor-based pagination, not offset-based.

**Context:** The mobile app uses infinite scroll. With offset pagination, if new items are inserted while the user scrolls, they see duplicates or skip items. Cursor pagination (keyed on the last-seen item ID) provides stable results regardless of concurrent inserts. This is critical for a live marketplace where listings are created and sold continuously.

**Consequences:**

- Cannot jump to an arbitrary page number (no "page 5 of 12").
- Forward-only navigation (no "previous page" — the client stores seen items).
- Response includes `nextCursor` when more items exist.
- Simpler and more performant than offset queries for large datasets.

---

## ADR-007: BullMQ for Background Jobs

**Decision:** Long-running tasks (email delivery, image processing, payouts, pickup timeouts) are processed by BullMQ workers running on a separate persistent process.

**Context:** Vercel serverless functions have a 10-second execution limit (60s on Pro). Image processing with Sharp can take 5–15 seconds. Stripe payout webhooks need reliable retry semantics. BullMQ provides job persistence, automatic retries, concurrency control, and rate limiting — all backed by Redis.

**Consequences:**

- Requires a separate worker deployment (Railway, Render, or any long-running Node.js host).
- Two Redis instances: Upstash (REST, for rate limiting/locks/cache in serverless) and IORedis (TCP, for BullMQ in the worker process).
- Jobs are enqueued from serverless functions but processed elsewhere.
- Four queues with different concurrency: `email` (5), `image` (3), `payout` (2), `pickup` (2).

**Example:** `src/worker.ts` (entry point), `src/server/workers/` (implementations)

---

## ADR-008: Cloudflare Turnstile for Bot Protection

**Decision:** Cloudflare Turnstile CAPTCHA is required on all public-facing forms (registration, login, listing creation).

**Context:** Peer-to-peer marketplaces are prime targets for spam (fake listings, account farming, price manipulation bots). Turnstile is less intrusive than reCAPTCHA and integrates well with Cloudflare's broader security tooling.

**Consequences:**

- Additional client-side script load (~30KB).
- Completely bypassed in non-production environments (both client-side config endpoint and server-side verification skip).
- Server verification is fail-closed in production — if Turnstile is down, form submissions are rejected.

**Example:** `src/server/lib/turnstile.ts`, `src/app/api/auth/turnstile-config/route.ts`

---

## ADR-009: JWT with Redis Blocklist

**Decision:** Auth.js uses JWT session strategy (1-hour max age) with a Redis-backed blocklist and session versioning for immediate revocation.

**Context:** Pure JWTs cannot be revoked — a banned user's token remains valid until expiry. The platform handles real money, so immediate ban enforcement and session invalidation are non-negotiable. The Redis blocklist (keyed by JWT `jti`) enables instant revocation, while session versioning (incremented on password change or admin action) invalidates all of a user's tokens across all devices.

**Consequences:**

- Every authenticated request checks Redis twice: blocklist lookup and session version comparison.
- Admin tokens use fail-closed Redis checks (if Redis is down, admin sessions are invalidated as a safety measure).
- Regular user tokens use fail-open (if Redis is down, sessions continue — availability over security for non-admin users).

**Example:** `src/lib/auth.ts` (JWT callback), `src/server/lib/jwtBlocklist.ts`, `src/server/lib/sessionStore.ts`

---

## ADR-010: Distributed Locking for Offer Acceptance

**Decision:** When a seller accepts an offer, a Redis distributed lock is acquired on the listing before the database transaction runs.

**Context:** Multiple buyers can have pending offers on the same listing. If a seller has two browser tabs open and clicks "accept" on two different offers simultaneously, without a lock both transactions could succeed — double-selling the item. The distributed lock ensures only one acceptance can proceed.

**Consequences:**

- Lock key: `listing:purchase:<listingId>`, TTL: 30 seconds.
- Production is fail-closed: if Redis is unavailable, offer acceptance returns a 503 rather than risking a double-sell.
- Development mode proceeds without locks for convenience.
- Lock uses compare-and-delete via Lua script to prevent accidental release by a different process.

**Example:** `src/modules/offers/offer.service.ts` (`respondOffer` method), `src/server/lib/distributedLock.ts`

---

# Data Flows

## User Registration Flow

1. User submits registration form with email, password, and Turnstile token.
2. Server action `register()` validates input with Zod, verifies Turnstile (production only).
3. Rate limiter checks: max 3 registrations per IP per hour.
4. Password hashed with Argon2id (64MB, 3 iterations).
5. User record created in database via `userRepository.create()`.
6. `email` queue job enqueued: welcome email.
7. Audit log written (fire-and-forget).
8. Auth.js session created (JWT issued).
9. User redirected to onboarding flow.

## Listing Creation Flow

1. Seller uploads images via presigned R2 URLs (client-side direct upload).
2. `image` queue jobs enqueued per image: virus scan, resize, WebP conversion, EXIF strip.
3. Seller submits listing form with title, description, price (converted to cents), category, condition, shipping options.
4. Server action validates with Zod schema, checks seller verification status.
5. Listing created with status `PENDING_REVIEW` (or `ACTIVE` if seller is verified and trusted).
6. Admin notification created if manual review required.
7. Listing indexed for search.

## Checkout and Payment Flow

1. Buyer clicks "Buy Now" or checks out from cart.
2. Server action creates order with status `AWAITING_PAYMENT`.
3. Stripe PaymentIntent created with `capture_method: 'manual'` (escrow — funds authorised but not captured).
4. Client confirms payment via Stripe.js.
5. Stripe webhook fires `payment_intent.succeeded`.
6. Webhook handler transitions order to `PAYMENT_HELD`, listing to `RESERVED`.
7. Seller notified to dispatch.
8. Seller marks as dispatched → order transitions to `DISPATCHED`.
9. Buyer confirms delivery → Stripe capture executes, order transitions to `COMPLETED`.
10. `payout` queue job enqueued: Stripe Connect transfer to seller.
11. If buyer doesn't confirm within N business days, `auto-release` cron captures payment automatically.

## Dispute Resolution Flow

1. Buyer or seller opens a dispute on a `PAYMENT_HELD`, `DISPATCHED`, or `DELIVERED` order.
2. Order transitions to `DISPUTED`. Both parties notified.
3. Both parties can submit evidence (text + up to 4 image files).
4. `dispute-auto-resolve` cron checks daily:
   - If seller hasn't responded after configurable hours → auto-resolve in buyer's favour.
   - AI-assisted inconsistency analysis runs on submitted evidence.
5. Auto-resolution queued with 24-hour cooling period (allows counter-evidence).
6. After cooling period: if no counter-evidence, resolution executes (refund or release).
7. If counter-evidence submitted: resolution re-evaluated.
8. Admin can manually override at any point.
9. Completed disputes update seller trust metrics and may trigger tier downgrade.
