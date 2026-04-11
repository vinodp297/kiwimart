// src/test/audit-fixes-batch2.test.ts
// ─── Tests: Production audit fixes (batch 2) ─────────────────────────────────
// Covers Fix 8 (architectural lint compliance for workers/jobs/services/lib)
// and Fix 10 (listing reservedUntil + stale-reservation reconciliation cron).
//
// These tests rely on file-system inspection rather than runtime mocks because
// the goal is to verify the code shape that protects against regressions:
//   • workers/jobs/services may not import @/lib/db directly
//   • the reservedUntil field, migration, repository method, and cron route
//     all exist and reference each other correctly.

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = process.cwd();

function read(rel: string): string {
  return fs.readFileSync(path.resolve(ROOT, rel), "utf-8");
}

function exists(rel: string): boolean {
  return fs.existsSync(path.resolve(ROOT, rel));
}

describe("Audit fixes batch 2 — Fix 8: layered architecture (workers/jobs/services/lib)", () => {
  // ── 1. ESLint config restricts @/lib/db across all four scopes ───────────
  it("eslint.config.mjs covers src/server/workers, jobs, services, and lib in no-restricted-imports", () => {
    const config = read("eslint.config.mjs");
    expect(config).toContain("src/server/workers/**");
    expect(config).toContain("src/server/jobs/**");
    expect(config).toContain("src/server/services/**");
    expect(config).toContain("src/server/lib/**");
  });

  // ── 2. payoutWorker — no direct db import ────────────────────────────────
  it("payoutWorker.ts does not import @/lib/db", () => {
    const src = read("src/server/workers/payoutWorker.ts");
    expect(src).not.toMatch(/from\s+["']@\/lib\/db["']/);
    expect(src).toContain("payoutRepository");
  });

  // ── 3. pickupWorker — no direct db import, uses withTransaction ──────────
  it("pickupWorker.ts uses withTransaction and repositories instead of @/lib/db", () => {
    const src = read("src/server/workers/pickupWorker.ts");
    expect(src).not.toMatch(/from\s+["']@\/lib\/db["']/);
    expect(src).toContain("withTransaction");
    expect(src).toContain("trustMetricsRepository");
    expect(src).toContain("listingRepository");
  });

  // ── 4. autoReleaseEscrow — refactored ────────────────────────────────────
  it("autoReleaseEscrow.ts uses orderRepository + payoutRepository", () => {
    const src = read("src/server/jobs/autoReleaseEscrow.ts");
    expect(src).not.toMatch(/from\s+["']@\/lib\/db["']/);
    expect(src).toContain("orderRepository.findDispatchedForAutoRelease");
    expect(src).toContain("payoutRepository.markProcessingByOrderId");
  });

  // ── 5. dispatchReminders — refactored ────────────────────────────────────
  it("dispatchReminders.ts uses orderRepository + notificationRepository", () => {
    const src = read("src/server/jobs/dispatchReminders.ts");
    expect(src).not.toMatch(/from\s+["']@\/lib\/db["']/);
    expect(src).toContain("orderRepository.findUndispatchedOlderThan");
    expect(src).toContain("notificationRepository.findRecentSystemForOrders");
  });

  // ── 6. disputeAutoResolve — refactored ───────────────────────────────────
  it("disputeAutoResolve.ts uses orderRepository + interactionRepository", () => {
    const src = read("src/server/jobs/disputeAutoResolve.ts");
    expect(src).not.toMatch(/from\s+["']@\/lib\/db["']/);
    expect(src).toContain("orderRepository.findQueuedAutoResolutionEvents");
    expect(src).toContain("interactionRepository.findExpiredAutoEscalate");
  });

  // ── 7. priceDropNotifications — refactored ───────────────────────────────
  it("priceDropNotifications.ts uses watchlistRepository + withTransaction", () => {
    const src = read("src/server/jobs/priceDropNotifications.ts");
    expect(src).not.toMatch(/from\s+["']@\/lib\/db["']/);
    expect(src).toContain("watchlistRepository.findActivePriceAlerts");
    expect(src).toContain("withTransaction");
  });

  // ── 8. sellerDowngradeCheck — refactored ─────────────────────────────────
  it("sellerDowngradeCheck.ts uses userRepository methods", () => {
    const src = read("src/server/jobs/sellerDowngradeCheck.ts");
    expect(src).not.toMatch(/from\s+["']@\/lib\/db["']/);
    expect(src).toContain("userRepository.findSellersExceedingDisputeRate");
    expect(src).toContain("userRepository.applySellerTierDowngrade");
  });

  // ── 9. stripeReconciliation — refactored ─────────────────────────────────
  it("stripeReconciliation.ts uses orderRepository (DB-driven auto-fix) instead of db", () => {
    const src = read("src/server/jobs/stripeReconciliation.ts");
    expect(src).not.toMatch(/from\s+["']@\/lib\/db["']/);
    expect(src).toContain("orderRepository.findAwaitingPaymentWithPiOlderThan");
    expect(src).toContain("orderRepository.findPaymentHeldWithPiOlderThan");
  });

  // ── 10. withTransaction helper exists at src/lib (outside lint scope) ────
  it("withTransaction helper lives at src/lib/transaction.ts and not under src/server/lib", () => {
    expect(exists("src/lib/transaction.ts")).toBe(true);
    expect(exists("src/server/lib/transaction.ts")).toBe(false);
    const src = read("src/lib/transaction.ts");
    expect(src).toContain("export function withTransaction");
    expect(src).toContain("$transaction");
  });
});

describe("Audit fixes batch 2 — Fix 10: listing reservedUntil + reconciliation", () => {
  // ── 11. Schema has reservedUntil field + composite index ─────────────────
  it("Listing model has reservedUntil DateTime? and composite index", () => {
    const schema = read("prisma/schema.prisma");
    expect(schema).toMatch(/reservedUntil\s+DateTime\?/);
    expect(schema).toContain("Listing_status_reservedUntil_idx");
  });

  // ── 12. Migration file exists with the expected name ────────────────────
  it("add_listing_reserved_until migration exists with column + index DDL", () => {
    const migrationPath =
      "prisma/migrations/20260410_add_listing_reserved_until/migration.sql";
    expect(exists(migrationPath)).toBe(true);
    const sql = read(migrationPath);
    expect(sql).toContain('ADD COLUMN "reservedUntil"');
    expect(sql).toContain("Listing_status_reservedUntil_idx");
  });

  // ── 13. reserveListing sets the 10-minute deadline + handles stale OR ───
  it("orderRepository.reserveListing stamps reservedUntil and accepts stale RESERVED listings", () => {
    const src = read("src/modules/orders/order.repository.ts");
    // Locate the reserveListing function body
    const match = src.match(
      /async reserveListing\(listingId: string,[\s\S]*?\n {2}\},/,
    );
    expect(match).not.toBeNull();
    const body = match![0];
    expect(body).toContain("reservedUntil");
    // 10 minute window
    expect(body).toMatch(/10\s*\*\s*60\s*\*\s*1000/);
    // Accepts ACTIVE OR a RESERVED listing whose reservedUntil has lapsed
    expect(body).toContain('status: "ACTIVE"');
    expect(body).toContain('status: "RESERVED"');
    expect(body).toMatch(/reservedUntil:\s*\{\s*lt:/);
  });

  // ── 14. Reconciliation cron job + route exist and are wired in vercel.json
  it("releaseStaleReservations cron job, route, and vercel schedule are present", () => {
    expect(exists("src/server/jobs/releaseStaleReservations.ts")).toBe(true);
    expect(exists("src/app/api/cron/release-stale-reservations/route.ts")).toBe(
      true,
    );

    const job = read("src/server/jobs/releaseStaleReservations.ts");
    expect(job).toContain("listingRepository.releaseStaleReservations");
    expect(job).toContain("acquireLock");

    const route = read("src/app/api/cron/release-stale-reservations/route.ts");
    expect(route).toContain("releaseStaleReservations");
    expect(route).toContain("verifyCronSecret");

    const vercel = JSON.parse(read("vercel.json")) as {
      crons: Array<{ path: string; schedule: string }>;
    };
    const entry = vercel.crons.find(
      (c) => c.path === "/api/cron/release-stale-reservations",
    );
    expect(entry).toBeDefined();
    expect(entry!.schedule).toBe("*/5 * * * *");

    const listingRepo = read("src/modules/listings/listing.repository.ts");
    expect(listingRepo).toContain("releaseStaleReservations");
    expect(listingRepo).toMatch(/reservedUntil:\s*\{\s*lt:/);
  });
});
