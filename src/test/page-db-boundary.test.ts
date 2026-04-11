// src/test/page-db-boundary.test.ts
// ─── Architecture guard: no page.tsx may import @/lib/db directly ─────────────
//
// Pages must delegate all data fetching to services, which call repositories,
// which own the db import. This test enforces that boundary statically by
// reading every page.tsx source file and asserting the forbidden import is absent.

import { describe, it, expect } from "vitest";
import { globSync } from "glob";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");
const SRC_ROOT = resolve(PROJECT_ROOT, "src/app");

describe("page-db-boundary", () => {
  const pageFiles = globSync("**/page.tsx", {
    cwd: SRC_ROOT,
    absolute: true,
  });

  it("should find at least one page.tsx to validate", () => {
    expect(pageFiles.length).toBeGreaterThan(0);
  });

  it.each(pageFiles.map((f) => [f.replace(PROJECT_ROOT + "/", ""), f]))(
    "%s must not import @/lib/db",
    (_label, filePath) => {
      const source = readFileSync(filePath, "utf-8");
      const hasDbImport = /from\s+["']@\/lib\/db["']/.test(source);
      expect(
        hasDbImport,
        `${_label} imports @/lib/db directly — move the query to a service/repository`,
      ).toBe(false);
    },
  );
});
