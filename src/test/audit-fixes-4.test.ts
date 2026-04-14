// src/test/audit-fixes-4.test.ts
// ─── Audit Delta Sprint 2 — structural assertions ─────────────────────────────
//
//  Fix 3: sitemap.ts no longer imports @/lib/db directly
//         getSitemapListings / getSitemapSellers live in listing.repository.ts
//
//  Fix 4: interaction-workflow.service.ts is a pure re-export barrel (no class)
//         InteractionWorkflowService / interactionWorkflowService live in .instance.ts
//         All 4 workflow functions are still importable from the barrel

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf-8");
}

// ─────────────────────────────────────────────────────────────────────────────
// Fix 3 — sitemap.ts uses repository, not db directly
// ─────────────────────────────────────────────────────────────────────────────

describe("Fix 3 — sitemap.ts DB abstraction", () => {
  it("sitemap.ts does not import from @/lib/db", () => {
    const source = read("src/app/sitemap.ts");
    expect(source).not.toMatch(/from\s+["']@\/lib\/db["']/);
  });

  it("sitemap.ts imports getSitemapListings from listing.repository", () => {
    const source = read("src/app/sitemap.ts");
    expect(source).toContain("getSitemapListings");
    expect(source).toContain("listing.repository");
  });

  it("getSitemapListings is exported from listing.repository.ts", () => {
    const source = read("src/modules/listings/listing-query.repository.ts");
    expect(source).toContain("export async function getSitemapListings");
  });

  it("getSitemapSellers is exported from listing.repository.ts", () => {
    const source = read("src/modules/listings/listing-query.repository.ts");
    expect(source).toContain("export async function getSitemapSellers");
  });

  it("getSitemapListings returns id and updatedAt", () => {
    const source = read("src/modules/listings/listing-query.repository.ts");
    // The select clause must project both id and updatedAt
    expect(source).toMatch(/getSitemapListings[\s\S]{0,300}id:\s*true/);
    expect(source).toMatch(/getSitemapListings[\s\S]{0,300}updatedAt:\s*true/);
  });

  it("getSitemapSellers returns username and updatedAt", () => {
    const source = read("src/modules/listings/listing-query.repository.ts");
    expect(source).toMatch(/getSitemapSellers[\s\S]{0,300}username:\s*true/);
    expect(source).toMatch(/getSitemapSellers[\s\S]{0,300}updatedAt:\s*true/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fix 4 — interaction-workflow barrel is pure; class lives in .instance.ts
// ─────────────────────────────────────────────────────────────────────────────

describe("Fix 4 — interaction-workflow barrel / instance split", () => {
  it("interaction-workflow.service.ts contains no class definition", () => {
    const source = read("src/modules/orders/interaction-workflow.service.ts");
    expect(source).not.toContain("export class InteractionWorkflowService");
    expect(source).not.toContain("new InteractionWorkflowService");
  });

  it("interaction-workflow.service.ts contains only re-exports (no logic)", () => {
    const source = read("src/modules/orders/interaction-workflow.service.ts");
    // Strip line comments then check for logic keywords
    const stripped = source
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    expect(stripped).not.toMatch(/\bclass\b/);
    expect(stripped).not.toMatch(/\bconst\b/);
    expect(stripped).not.toMatch(/^import\s/m);
    expect(stripped).not.toMatch(/\bfunction\b/);
  });

  it("interaction-workflow.instance.ts exports InteractionWorkflowService class", () => {
    const source = read("src/modules/orders/interaction-workflow.instance.ts");
    expect(source).toContain("export class InteractionWorkflowService");
  });

  it("interaction-workflow.instance.ts exports the interactionWorkflowService singleton", () => {
    const source = read("src/modules/orders/interaction-workflow.instance.ts");
    expect(source).toContain("export const interactionWorkflowService");
  });

  it("all 4 workflow functions are re-exported from the barrel", () => {
    const source = read("src/modules/orders/interaction-workflow.service.ts");
    expect(source).toContain("requestCancellation");
    expect(source).toContain("requestReturn");
    expect(source).toContain("requestPartialRefund");
    expect(source).toContain("notifyShippingDelay");
  });

  it("interactions.ts server action imports from .instance.ts (not barrel)", () => {
    const source = read("src/server/actions/interactions.ts");
    expect(source).toContain("interaction-workflow.instance");
    expect(source).not.toMatch(
      /from\s+["'].*interaction-workflow\.service["']/,
    );
  });
});
