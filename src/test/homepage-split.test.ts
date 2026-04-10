// src/test/homepage-split.test.ts
// ─── Tests: Homepage monolith split (Task I4) ─────────────────────────────────
// Verifies that:
//   1. fetchHomeData() exists and exports the correct return type shape
//   2. The three focused components exist at the expected paths
//   3. page.tsx is under 80 lines (thin orchestrator only)

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = process.cwd();

function lineCount(rel: string): number {
  const content = fs.readFileSync(path.resolve(ROOT, rel), "utf-8");
  return content.split("\n").length;
}

function exists(rel: string): boolean {
  return fs.existsSync(path.resolve(ROOT, rel));
}

function read(rel: string): string {
  return fs.readFileSync(path.resolve(ROOT, rel), "utf-8");
}

describe("Homepage split — Task I4", () => {
  // ── Test 1: Focused component files exist ────────────────────────────────
  it("HomeHero, HomeCategories, HomeFeaturedListings components exist", () => {
    expect(exists("src/app/(public)/_components/HomeHero.tsx")).toBe(true);
    expect(exists("src/app/(public)/_components/HomeCategories.tsx")).toBe(
      true,
    );
    expect(
      exists("src/app/(public)/_components/HomeFeaturedListings.tsx"),
    ).toBe(true);
  });

  // ── Test 2: home-data.ts exists and exports fetchHomeData ────────────────
  it("home-data.ts exists and exports fetchHomeData", () => {
    expect(exists("src/app/(public)/_lib/home-data.ts")).toBe(true);

    const content = read("src/app/(public)/_lib/home-data.ts");
    expect(content).toContain("export async function fetchHomeData");
    expect(content).toContain("HomePageData");
  });

  // ── Test 3: page.tsx is under 80 lines ───────────────────────────────────
  it("page.tsx is under 80 lines after split", () => {
    const lines = lineCount("src/app/(public)/page.tsx");
    expect(lines).toBeLessThanOrEqual(80);
  });
});
