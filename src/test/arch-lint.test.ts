// src/test/arch-lint.test.ts
// ─── Tests: Architecture lint rules (Task I2) ─────────────────────────────────
// Verifies that:
//   1. eslint.config.mjs covers src/app/**  in the no-restricted-imports rule
//   2. CI workflow uses --max-warnings 0 on the lint step
//   3. The no-restricted-imports rule targets @/lib/db for the layered architecture

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = process.cwd();

function read(rel: string): string {
  return fs.readFileSync(path.resolve(ROOT, rel), "utf-8");
}

describe("Architecture lint — Task I2", () => {
  // ── Test 1: eslint.config.mjs covers src/app/** ──────────────────────────
  it("eslint.config.mjs includes src/app/**/*.ts and src/app/**/*.tsx in no-restricted-imports files", () => {
    const config = read("eslint.config.mjs");

    // Both app TS and TSX patterns must be present in the files array
    expect(config).toContain("src/app/**/*.ts");
    expect(config).toContain("src/app/**/*.tsx");
  });

  // ── Test 2: CI lint step uses --max-warnings 0 ────────────────────────────
  it("CI workflow lint step passes --max-warnings 0", () => {
    const ci = read(".github/workflows/ci.yml");

    // The lint command must have the zero-warnings flag so warnings become
    // failures in CI, preventing accidental rule degradation.
    expect(ci).toContain("--max-warnings 0");
  });

  // ── Test 3: Rule targets @/lib/db (the DB access restriction) ────────────
  it("eslint.config.mjs no-restricted-imports rule targets @/lib/db", () => {
    const config = read("eslint.config.mjs");

    // Confirm the actual restricted module name is present — prevents a refactor
    // accidentally changing the import specifier without updating the lint rule.
    expect(config).toContain("@/lib/db");
    // Rule severity must be 'error', not 'warn' (warns would pass --max-warnings 0 counting)
    expect(config).toContain("'error'");
  });
});
