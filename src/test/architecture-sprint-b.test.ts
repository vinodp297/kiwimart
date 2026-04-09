// src/test/architecture-sprint-b.test.ts
// ─── Architecture Sprint B — listing.service.ts split and shared orchestration
//
// Fix 1: listing.service.ts split into focused sub-services
// Fix 2: Shared creation orchestration in service layer (not duplicated)

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(process.cwd());

// ═══════════════════════════════════════════════════════════════════════════════
// Fix 1 — Sub-service files exist and barrel re-exports everything
// ═══════════════════════════════════════════════════════════════════════════════

describe("Fix 1 — listing.service.ts split into sub-services", () => {
  const subServices = [
    "listing-create.service.ts",
    "listing-lifecycle.service.ts",
    "listing-engagement.service.ts",
    "listing-queries.service.ts",
    "listing-review.service.ts",
  ];

  for (const file of subServices) {
    it(`${file} exists`, () => {
      const filePath = resolve(ROOT, "src/modules/listings", file);
      expect(existsSync(filePath)).toBe(true);
    });
  }

  it("barrel listing.service.ts exists and exports listingService", () => {
    const barrelPath = resolve(ROOT, "src/modules/listings/listing.service.ts");
    const content = readFileSync(barrelPath, "utf-8");

    expect(content).toContain("export const listingService");
  });

  it("barrel re-exports all 10 public methods on listingService", () => {
    const barrelPath = resolve(ROOT, "src/modules/listings/listing.service.ts");
    const content = readFileSync(barrelPath, "utf-8");

    const requiredMethods = [
      "createListing",
      "createListingViaApi",
      "saveDraft",
      "deleteListing",
      "updateListing",
      "patchListingViaApi",
      "toggleWatch",
      "getListingById",
      "getBrowseListings",
      "getListingForEdit",
    ];

    for (const method of requiredMethods) {
      expect(content).toContain(method);
    }
  });

  it("barrel re-exports all types", () => {
    const barrelPath = resolve(ROOT, "src/modules/listings/listing.service.ts");
    const content = readFileSync(barrelPath, "utf-8");

    expect(content).toContain("CreateListingInput");
    expect(content).toContain("SaveDraftInput");
    expect(content).toContain("UpdateListingInput");
    expect(content).toContain("CreateResult");
    expect(content).toContain("DraftResult");
    expect(content).toContain("UpdateResult");
  });

  it("barrel file is a thin re-export (no business logic)", () => {
    const barrelPath = resolve(ROOT, "src/modules/listings/listing.service.ts");
    const content = readFileSync(barrelPath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim() !== "");

    // Barrel should be small — just imports and the object export
    expect(lines.length).toBeLessThan(60);
    // Should not contain repository calls, audit calls, or logger calls
    expect(content).not.toContain("listingRepository.");
    expect(content).not.toContain("audit(");
    expect(content).not.toContain("logger.");
  });

  it("listing-create.service.ts contains createListing and saveDraft", () => {
    const filePath = resolve(
      ROOT,
      "src/modules/listings/listing-create.service.ts",
    );
    const content = readFileSync(filePath, "utf-8");

    expect(content).toContain("export async function createListing");
    expect(content).toContain("export async function saveDraft");
    expect(content).toContain("export async function createListingViaApi");
  });

  it("listing-lifecycle.service.ts contains updateListing and deleteListing", () => {
    const filePath = resolve(
      ROOT,
      "src/modules/listings/listing-lifecycle.service.ts",
    );
    const content = readFileSync(filePath, "utf-8");

    expect(content).toContain("export async function updateListing");
    expect(content).toContain("export async function deleteListing");
    expect(content).toContain("export async function patchListingViaApi");
  });

  it("listing-engagement.service.ts contains toggleWatch and getListingById", () => {
    const filePath = resolve(
      ROOT,
      "src/modules/listings/listing-engagement.service.ts",
    );
    const content = readFileSync(filePath, "utf-8");

    expect(content).toContain("export async function toggleWatch");
    expect(content).toContain("export async function getListingById");
  });

  it("listing-queries.service.ts contains getBrowseListings and getListingForEdit", () => {
    const filePath = resolve(
      ROOT,
      "src/modules/listings/listing-queries.service.ts",
    );
    const content = readFileSync(filePath, "utf-8");

    expect(content).toContain("export async function getBrowseListings");
    expect(content).toContain("export async function getListingForEdit");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fix 2 — Shared creation orchestration (not duplicated in adapters)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Fix 2 — shared listing creation orchestration", () => {
  it("createListing and createListingViaApi share validateAndCreateListing core", () => {
    const filePath = resolve(
      ROOT,
      "src/modules/listings/listing-create.service.ts",
    );
    const content = readFileSync(filePath, "utf-8");

    // The shared core function must exist
    expect(content).toContain("validateAndCreateListing");

    // Both public functions must call the shared core
    const createListingFn = content.slice(
      content.indexOf("export async function createListing("),
    );
    const createViaApiFn = content.slice(
      content.indexOf("export async function createListingViaApi("),
    );

    expect(createListingFn).toContain("validateAndCreateListing");
    expect(createViaApiFn).toContain("validateAndCreateListing");
  });

  it("auth checks are NOT duplicated — only in validateAndCreateListing", () => {
    const filePath = resolve(
      ROOT,
      "src/modules/listings/listing-create.service.ts",
    );
    const content = readFileSync(filePath, "utf-8");

    // findForListingAuth should appear exactly once (in the shared core)
    const matches = content.match(/findForListingAuth/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("category validation is NOT duplicated — only in validateAndCreateListing", () => {
    const filePath = resolve(
      ROOT,
      "src/modules/listings/listing-create.service.ts",
    );
    const content = readFileSync(filePath, "utf-8");

    // findCategoryById should appear exactly once (in the shared core)
    const matches = content.match(/findCategoryById/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("image validation is NOT duplicated — only in validateAndCreateListing", () => {
    const filePath = resolve(
      ROOT,
      "src/modules/listings/listing-create.service.ts",
    );
    const content = readFileSync(filePath, "utf-8");

    // findImagesByKeys should appear exactly once (in the shared core)
    const matches = content.match(/findImagesByKeys/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("listing creation transaction is NOT duplicated — only in validateAndCreateListing", () => {
    const filePath = resolve(
      ROOT,
      "src/modules/listings/listing-create.service.ts",
    );
    const content = readFileSync(filePath, "utf-8");

    // $transaction should appear exactly once
    const matches = content.match(/\$transaction/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("API route delegates to listingService, does not inline business logic", () => {
    const routePath = resolve(ROOT, "src/app/api/v1/listings/route.ts");
    const content = readFileSync(routePath, "utf-8");

    // Route should call the service, not the repository directly
    expect(content).toContain("listingService.createListingViaApi");
    expect(content).not.toContain("listingRepository");
    expect(content).not.toContain("findForListingAuth");
    expect(content).not.toContain("findCategoryById");
  });
});
