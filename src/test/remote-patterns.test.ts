// src/test/remote-patterns.test.ts
// ─── next.config.ts remotePatterns cleanup ────────────────────────────────────
// Verifies that canonical image hosts are still present and that the four dead
// patterns (S3 API endpoints and duplicate explicit r2.dev entry) are removed.

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const config = readFileSync(resolve(process.cwd(), "next.config.ts"), "utf-8");

describe("next.config.ts remotePatterns", () => {
  // 1. Canonical patterns still present
  it("keeps images.unsplash.com (fallback and seed images)", () => {
    expect(config).toContain("images.unsplash.com");
  });

  it("keeps pub-*.r2.dev (wildcard covers all R2 public URLs)", () => {
    expect(config).toContain("pub-*.r2.dev");
  });

  it("keeps r2.kiwimart.co.nz (production R2 public URL)", () => {
    expect(config).toContain("r2.kiwimart.co.nz");
  });

  it("keeps dynamic r2Host derived from NEXT_PUBLIC_R2_PUBLIC_URL", () => {
    expect(config).toContain("r2Hostname");
    expect(config).toContain("r2Host");
  });

  // 2. Dead patterns removed
  it("removes *.cloudflare.com (not a reachable image host)", () => {
    expect(config).not.toContain('"*.cloudflare.com"');
  });

  it("removes *.cloudflarestorage.com (S3 API endpoint, not publicly accessible)", () => {
    expect(config).not.toContain('"*.cloudflarestorage.com"');
  });

  it("removes *.r2.cloudflarestorage.com (S3 API endpoint, not publicly accessible)", () => {
    expect(config).not.toContain('"*.r2.cloudflarestorage.com"');
  });

  it("removes the explicit pub-2617...r2.dev entry (already covered by pub-*.r2.dev)", () => {
    expect(config).not.toContain("pub-2617903b3bbb49de8c16c6d5d59ca3ef.r2.dev");
  });
});
