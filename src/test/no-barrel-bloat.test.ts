// src/test/no-barrel-bloat.test.ts
// ─── Tests: No low-value barrel abstractions (Task A3) ───────────────────────
// Verifies that the modules/ directory does not contain single-file re-export
// barrels with zero callers. The sprint B architecture already split
// listing.service.ts into sub-services; those have no index.ts barrel.

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { globSync } from "glob";

const ROOT = process.cwd();

describe("No low-value barrel bloat — Task A3", () => {
  // ── Test 1: No standalone index.ts barrel files inside module subdirs ────
  // Each module dir may contain services, repositories, and schemas.
  // A bare index.ts that only re-exports from ONE sibling file in the same
  // directory is considered a low-value barrel (one-to-one pass-through).
  it("no src/modules subdirectory contains a single-file pass-through index.ts", () => {
    const indexFiles = globSync("src/modules/**/index.ts", { cwd: ROOT });

    for (const indexFile of indexFiles) {
      const content = fs.readFileSync(path.resolve(ROOT, indexFile), "utf-8");
      // Count distinct 'from' targets (import sources)
      const fromMatches = content.match(/from\s+["'][^"']+["']/g) ?? [];
      const uniqueSources = new Set(
        fromMatches.map((m) =>
          m.replace(/from\s+["']/, "").replace(/["']$/, ""),
        ),
      );
      // A barrel that re-exports from only one source is a pass-through.
      // Allow 0 (empty barrel is a syntax artifact, not a bloat issue)
      // or ≥ 2 (genuine aggregation).
      const isSingleFilePassThrough =
        uniqueSources.size === 1 &&
        !Array.from(uniqueSources)[0]!.startsWith("@/"); // external = ok

      expect(
        isSingleFilePassThrough,
        `${indexFile} is a single-file pass-through barrel — consolidate or remove it`,
      ).toBe(false);
    }
  });

  // ── Test 2: The listing sub-services do not have an unnecessary barrel ────
  // Sprint B split listing.service.ts into 5 sub-services. These are consumed
  // directly by callers — a barrel would add indirection with no benefit.
  it("src/modules/listings does not contain an index.ts barrel", () => {
    const listingsIndex = path.resolve(ROOT, "src/modules/listings/index.ts");
    expect(
      fs.existsSync(listingsIndex),
      "src/modules/listings/index.ts should not exist — callers import sub-services directly",
    ).toBe(false);
  });
});
