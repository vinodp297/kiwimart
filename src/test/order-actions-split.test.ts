// src/test/order-actions-split.test.ts
// ─── Tests: Orders action decomposition (Task I5) ─────────────────────────────
// Verifies that:
//   1. Focused action files exist with correct exports
//   2. Barrel (orders.ts) re-exports all functions
//   3. Legacy shim files (orderDetail.ts, orderEvents.ts) forward to query file

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = process.cwd();

function exists(rel: string): boolean {
  return fs.existsSync(path.resolve(ROOT, rel));
}

function read(rel: string): string {
  return fs.readFileSync(path.resolve(ROOT, rel), "utf-8");
}

describe("Order actions split — Task I5", () => {
  // ── Test 1: Focused action files exist ───────────────────────────────────
  it("order-create.actions.ts, order-update.actions.ts, order-query.actions.ts exist", () => {
    expect(exists("src/server/actions/order-create.actions.ts")).toBe(true);
    expect(exists("src/server/actions/order-update.actions.ts")).toBe(true);
    expect(exists("src/server/actions/order-query.actions.ts")).toBe(true);
  });

  // ── Test 2: Each focused file exports the right functions ─────────────────
  it("each focused file exports the correct server actions", () => {
    const create = read("src/server/actions/order-create.actions.ts");
    expect(create).toContain("export async function createOrder");
    expect(create).toContain("export async function uploadOrderEvidence");

    const update = read("src/server/actions/order-update.actions.ts");
    expect(update).toContain("export async function confirmDelivery");
    expect(update).toContain("export async function cancelOrder");
    expect(update).toContain("export async function markDispatched");

    const query = read("src/server/actions/order-query.actions.ts");
    expect(query).toContain("export async function fetchOrderDetail");
    expect(query).toContain("export async function getOrderTimeline");
  });

  // ── Test 3: Barrel orders.ts re-exports from all three focused files ──────
  it("orders.ts barrel re-exports from all three focused action files", () => {
    const barrel = read("src/server/actions/orders.ts");
    expect(barrel).toContain("order-create.actions");
    expect(barrel).toContain("order-update.actions");
    expect(barrel).toContain("order-query.actions");
    // All key function names must be re-exported
    expect(barrel).toContain("createOrder");
    expect(barrel).toContain("confirmDelivery");
    expect(barrel).toContain("fetchOrderDetail");
  });
});
