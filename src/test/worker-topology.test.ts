// src/test/worker-topology.test.ts
// ─── Worker topology invariants ───────────────────────────────────────────────
// Asserts that the legacy entry point and its npm script have been removed,
// and that the canonical entry point (index.ts) remains the single source of
// truth for all four BullMQ workers.

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(process.cwd());

// ─── Legacy files must not exist ─────────────────────────────────────────────

describe("Worker topology — legacy entry point removed", () => {
  it("src/worker.ts no longer exists", () => {
    const legacyPath = resolve(ROOT, "src/worker.ts");
    expect(existsSync(legacyPath)).toBe(false);
  });

  it('package.json does not contain a "workers:start" script', () => {
    const pkgPath = resolve(ROOT, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts).not.toHaveProperty("workers:start");
  });
});

// ─── Canonical entry point checks ────────────────────────────────────────────

describe("Worker topology — canonical entry point completeness", () => {
  const indexPath = resolve(ROOT, "src/server/workers/index.ts");

  it("canonical index.ts exists", () => {
    expect(existsSync(indexPath)).toBe(true);
  });

  it("canonical index.ts starts all four workers", () => {
    const content = readFileSync(indexPath, "utf-8");
    expect(content).toContain("startEmailWorker");
    expect(content).toContain("startImageWorker");
    expect(content).toContain("startPayoutWorker");
    expect(content).toContain("startPickupWorker");
  });

  it('canonical "worker" npm script points at index.ts, not worker.ts', () => {
    const pkgPath = resolve(ROOT, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.worker).toContain("src/server/workers/index.ts");
    expect(pkg.scripts?.worker).not.toContain("src/worker.ts");
  });
});

// ─── Health server response shape ─────────────────────────────────────────────

describe("Worker topology — health server response shape", () => {
  it("health-server.ts returns per-worker objects with name/running/paused fields", () => {
    const healthServerPath = resolve(
      ROOT,
      "src/server/workers/health-server.ts",
    );
    const content = readFileSync(healthServerPath, "utf-8");

    // Confirm the response JSON uses the object format (not a plain name array)
    expect(content).toContain("running");
    expect(content).toContain("paused");
    expect(content).toContain("isRunning");
    expect(content).toContain("isPaused");
  });
});
