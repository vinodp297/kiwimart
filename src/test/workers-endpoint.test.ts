// src/test/workers-endpoint.test.ts
// ─── Tests: /api/workers legacy endpoint removed ─────────────────────────────
// Fix 3 chose Option B: remove the redundant /api/workers startup endpoint.
//
// Reason: render.yaml uses `npm run worker` → src/server/workers/index.ts as
// the canonical worker entry point. The API endpoint was a legacy Sprint 4
// artifact (labelled "Railway/deployment init") and is not referenced by any
// deployment config (verified: render.yaml, vercel.json). Removing it
// eliminates the drift bug (pickup worker missing) and the maintenance burden
// of keeping a redundant startup path in sync with index.ts.
//
// Tests:
//   1. The legacy /api/workers/route.ts file no longer exists
//   2. The canonical entry point (index.ts) imports all 4 workers incl. pickup

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(process.cwd());

describe("Fix 3 — legacy /api/workers startup endpoint removed", () => {
  it("src/app/api/workers/route.ts no longer exists", () => {
    const legacyPath = resolve(ROOT, "src/app/api/workers/route.ts");
    expect(existsSync(legacyPath)).toBe(false);
  });

  it("canonical index.ts imports all 4 workers including pickup", () => {
    const indexPath = resolve(ROOT, "src/server/workers/index.ts");
    const content = readFileSync(indexPath, "utf-8");

    // All four workers must be present in the canonical entry point
    expect(content).toContain("startEmailWorker");
    expect(content).toContain("startImageWorker");
    expect(content).toContain("startPayoutWorker");
    expect(content).toContain("startPickupWorker");
  });
});
