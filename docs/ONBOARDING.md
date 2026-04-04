# New Developer Onboarding

## Day 1: Understanding the System

1. Read this file top to bottom.
2. Read [ARCHITECTURE.md](./ARCHITECTURE.md) — especially the ADRs and data flow sections.
3. Set up your local environment by following the [README.md](../README.md) setup steps.
4. Browse the `src/modules/` folder — each subfolder is a complete feature slice (repository + service + schema + types). This is where all business logic lives.
5. Open Prisma Studio (`npm run db:studio`) and explore the data model visually.

## Key Files to Read First

Read these files in order to build a mental model of the system:

| #   | File                                        | Why                                                                                                                                               |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `prisma/schema.prisma`                      | The entire data model — all entities, enums, and relationships. Everything else builds on this.                                                   |
| 2   | `src/modules/orders/order.transitions.ts`   | The order state machine — the most important business logic in the system. Shows all valid status transitions and the optimistic locking pattern. |
| 3   | `src/server/lib/requireUser.ts`             | The auth guard used by every server action. Shows how sessions work, ban enforcement, and the `AuthenticatedUser` type.                           |
| 4   | `src/app/api/v1/_helpers/response.ts`       | The API response pattern — `apiOk()`, `apiError()`, `requireApiUser()` (dual auth), and rate limiting.                                            |
| 5   | `src/shared/errors/index.ts`                | The `AppError` class with factory methods. Every service throws these; every action/route catches them.                                           |
| 6   | `src/modules/orders/order-event.service.ts` | The event sourcing pattern — append-only audit trail for order lifecycle events.                                                                  |
| 7   | `src/server/lib/distributedLock.ts`         | Redis distributed locking — used for offer acceptance to prevent double-selling.                                                                  |
| 8   | `src/shared/types/action-result.ts`         | The `ActionResult<T>` type — every server action returns `ok(data)` or `fail(error)`.                                                             |
| 9   | `src/lib/auth.ts`                           | Auth.js v5 configuration — JWT strategy, providers, callbacks, blocklist integration, session versioning.                                         |
| 10  | `src/infrastructure/config/env.ts`          | Zod-validated environment variables — shows every external service the app depends on.                                                            |

## Domain Map

Each module in `src/modules/` owns a specific domain:

| Module           | Owns                                                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| `admin/`         | Admin panel operations: user management, listing moderation, dispute resolution, platform configuration              |
| `auth/`          | Authentication schemas (login/register validation) and MFA/TOTP service                                              |
| `cart/`          | Shopping cart CRUD — add, remove, update quantities, cart totals                                                     |
| `dashboard/`     | Seller and buyer dashboard analytics — sales metrics, order stats, revenue summaries                                 |
| `disputes/`      | Dispute lifecycle, evidence submission, AI-assisted inconsistency analysis, auto-resolution engine                   |
| `listings/`      | Listing CRUD, full-text search, price history tracking, recommendations, social proof, seller Q&A responses          |
| `messaging/`     | Real-time buyer-seller chat via Pusher with database persistence                                                     |
| `notifications/` | In-app notification creation, delivery, and read-status management                                                   |
| `offers/`        | Price negotiation — create, accept, reject, counter offers with distributed locking                                  |
| `orders/`        | Order lifecycle (state machine), checkout, dispatch, delivery confirmation, event audit trail, interaction workflows |
| `payments/`      | Stripe PaymentIntent creation, escrow capture/release, webhook handling, Connect payouts                             |
| `pickup/`        | In-person pickup scheduling, OTP verification, reschedule requests, no-show handling                                 |
| `reviews/`       | Two-way review system (buyer reviews seller, seller reviews buyer) with trust score integration                      |
| `sellers/`       | Seller profiles, trust score calculation, tier management (Bronze/Silver/Gold), response metrics                     |
| `trust/`         | Cross-cutting trust metrics aggregation — combines review scores, dispute rates, response times                      |
| `users/`         | User CRUD, profile management, authentication service, account deletion                                              |

## Common Tasks

### Add a New API Endpoint

1. Create a route file at `src/app/api/v1/<domain>/route.ts`.
2. Import helpers from `@/app/api/v1/_helpers/response`.
3. Use `requireApiUser(request)` for authentication.
4. Use `checkApiRateLimit(request, '<type>')` for rate limiting.
5. Delegate to the appropriate service method.
6. Return `apiOk(data)` or catch errors with `handleApiError(e)`.
7. Add CORS headers using the helper from `_helpers/cors.ts`.

```typescript
import {
  apiOk,
  handleApiError,
  requireApiUser,
  checkApiRateLimit,
} from "@/app/api/v1/_helpers/response";
import { withCors } from "@/app/api/v1/_helpers/cors";

export async function GET(request: Request) {
  try {
    const rateLimited = await checkApiRateLimit(request, "listing");
    if (rateLimited) return withCors(rateLimited);

    const user = await requireApiUser(request);
    const data = await someService.getData(user.id);
    return withCors(apiOk(data));
  } catch (e) {
    return withCors(handleApiError(e));
  }
}
```

### Add a New Server Action

1. Create or edit a file in `src/server/actions/`.
2. Add `"use server"` at the top.
3. Import `requireUser` from `@/server/lib/requireUser`.
4. Validate input with Zod.
5. Delegate to the service layer.
6. Return `ok(data)` or `fail(error)` from `@/shared/types/action-result`.

```typescript
"use server";

import { requireUser } from "@/server/lib/requireUser";
import { ok, fail, fromError } from "@/shared/types/action-result";
import { someSchema } from "@/modules/some/some.schema";
import { someService } from "@/modules/some/some.service";

export async function doSomething(input: unknown) {
  try {
    const user = await requireUser();
    const validated = someSchema.parse(input);
    const result = await someService.doSomething(user.id, validated);
    return ok(result);
  } catch (e) {
    return fromError(e);
  }
}
```

### Add a New Background Job

**For a cron job (runs on schedule via Vercel):**

1. Create the job function in `src/server/jobs/<jobName>.ts`.
2. Create an API route at `src/app/api/cron/<job-name>/route.ts`.
3. Protect the route with `verifyCronSecret(request)`.
4. Add the schedule to `vercel.json` under `crons`.

```typescript
// src/app/api/cron/my-job/route.ts
import { NextResponse } from "next/server";
import { verifyCronSecret } from "@/server/lib/verifyCronSecret";
import { myJob } from "@/server/jobs/myJob";

export async function GET(request: Request) {
  const authError = verifyCronSecret(request);
  if (authError) return authError;

  const result = await myJob();
  return NextResponse.json({ success: true, ...result });
}
```

**For a BullMQ worker job (runs on persistent process):**

1. Define the job data type in `src/lib/queue.ts`.
2. Create the worker in `src/server/workers/<name>Worker.ts`.
3. Register the worker in `src/worker.ts`.
4. Enqueue jobs from services via `queue.add('<queue-name>', data)`.

### Add a New Admin Page

1. Create a page at `src/app/(protected)/admin/<feature>/page.tsx`.
2. Use `requireAnyAdmin()` or `requirePermission('<permission>')` from `@/shared/auth` at the top of the page component or in the server action it calls.
3. Create components in `src/components/admin/`.
4. Admin pages are protected by the `(protected)` route group layout which checks authentication.

### Run the Test Suite

```bash
# Run all unit/integration tests
npm run test

# Run tests once (no watch mode)
npm run test:run

# Run with coverage report
npm run test:coverage

# Run end-to-end tests
npm run test:e2e

# Run e2e tests with browser visible
npm run test:e2e:headed

# Run e2e tests with Playwright UI
npm run test:e2e:ui
```

### Apply a Database Migration

```bash
# Development: create a new migration
npm run db:migrate
# Prompts for a migration name, generates SQL, applies it

# Production: apply pending migrations
npm run db:migrate:prod
# Equivalent to: npx prisma migrate deploy

# Safe migration (with backup script)
npm run db:migrate:safe

# Push schema without migration (prototyping only)
npm run db:push
```

## Testing

### Where Tests Live

- **Unit/integration tests:** `src/test/` — Vitest files named `*.test.ts`
- **E2E tests:** project root or `tests/` directory — Playwright files named `*.spec.ts`

### Test Pattern

Tests use Vitest with `vitest-mock-extended` for mocking. Here's the typical pattern from existing tests:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDeep, mockReset } from "vitest-mock-extended";

// Mock dependencies
vi.mock("@/lib/db", () => ({ db: mockDeep() }));

import { db } from "@/lib/db";
import { someService } from "@/modules/some/some.service";

const mockDb = db as unknown as ReturnType<typeof mockDeep>;

describe("SomeService", () => {
  beforeEach(() => {
    mockReset(mockDb);
  });

  it("should do the expected thing", async () => {
    // Arrange
    mockDb.someModel.findUnique.mockResolvedValue({ id: "1", name: "test" });

    // Act
    const result = await someService.doSomething("1");

    // Assert
    expect(result).toBeDefined();
    expect(mockDb.someModel.findUnique).toHaveBeenCalledWith({
      where: { id: "1" },
    });
  });
});
```

### Key Testing Conventions

- **Mock at the boundary:** Mock `db`, external services (Stripe, Resend, R2), and Redis. Never mock service-to-service calls within the same module.
- **Test services, not actions:** Server actions are thin wrappers. Test the service methods directly.
- **Use `mockDeep`:** Prisma's deeply nested query API requires deep mocking.
- **Reset between tests:** Always call `mockReset()` in `beforeEach` to prevent test pollution.

## Useful Commands Reference

| Command                 | Purpose                                |
| ----------------------- | -------------------------------------- |
| `npm run dev`           | Start development server               |
| `npm run build`         | Production build                       |
| `npm run test`          | Run tests in watch mode                |
| `npm run test:run`      | Run tests once                         |
| `npm run test:e2e`      | Run Playwright e2e tests               |
| `npm run db:migrate`    | Create and apply a migration           |
| `npm run db:seed`       | Seed database with sample data         |
| `npm run db:studio`     | Open Prisma Studio (visual DB browser) |
| `npm run workers:start` | Start BullMQ worker process            |
| `npm run workers:check` | Check for failed jobs                  |
| `npm run check-env`     | Validate environment variables         |
| `npm run lint`          | Run ESLint                             |
