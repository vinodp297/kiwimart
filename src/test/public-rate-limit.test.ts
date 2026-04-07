// src/test/public-rate-limit.test.ts
// ─── Tests: Rate limiting on public browse and search endpoints ───────────────
// Covers:
//   Browse listings (GET /api/v1/listings):
//     1. Allows requests within the 300/min limit (200)
//     2. Blocks the 301st request — returns 429
//     3. Uses publicRead key type, not the listing write key
//     4. Keys rate limit by IP address — not user ID
//     5. 429 response includes retryAfter
//   Search (GET /api/v1/search):
//     6. Allows requests within the 60/min limit (200)
//     7. Blocks the 61st request — returns 429
//     8. Uses publicSearch key type, not the listing write key
//     9. Keys rate limit by IP address — not user ID
//   Key type isolation:
//     10. publicRead and publicSearch keys are distinct from auth keys

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

// ── Service mocks ─────────────────────────────────────────────────────────────

vi.mock("@/modules/listings/listing.service", () => ({
  listingService: {
    getBrowseListings: vi.fn().mockResolvedValue({
      listings: [],
      nextCursor: null,
      hasMore: false,
    }),
  },
}));

vi.mock("@/modules/listings/search.service", () => ({
  searchService: {
    searchListings: vi.fn().mockResolvedValue({
      listings: [],
      page: 1,
      pageSize: 24,
      hasNextPage: false,
      totalCount: 0,
      totalPages: 0,
    }),
  },
}));

// Stub listing schema so test URLs don't fail Zod validation
vi.mock("@/modules/listings/listing.schema", () => {
  const { z } = require("zod");
  return {
    listingsQuerySchema: z.object({
      q: z.string().optional(),
      cursor: z.string().optional(),
      limit: z.coerce.number().min(1).max(48).default(24),
    }),
  };
});

// ── Route handlers (imported after mocks) ─────────────────────────────────────

const { GET: listingsGET } = await import("@/app/api/v1/listings/route");
const { GET: searchGET } = await import("@/app/api/v1/search/route");

import { rateLimit, getClientIp } from "@/server/lib/rateLimit";
import type { RateLimitKey } from "@/server/lib/rateLimit";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ALLOWED_RESULT = {
  success: true,
  remaining: 299,
  reset: Date.now() + 60_000,
  retryAfter: 0,
};

const BLOCKED_RESULT = {
  success: false,
  remaining: 0,
  reset: Date.now() + 60_000,
  retryAfter: 60,
};

const TEST_IP = "203.0.113.42";

function makeRequest(url: string): Request {
  return new Request(url, {
    headers: { "x-real-ip": TEST_IP },
  });
}

// ── Browse listings ───────────────────────────────────────────────────────────

describe("Browse listings rate limiting — GET /api/v1/listings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rateLimit).mockResolvedValue(ALLOWED_RESULT);
    vi.mocked(getClientIp).mockReturnValue(TEST_IP);
  });

  // Test 1
  it("allows requests within the 300/min limit — returns 200", async () => {
    vi.mocked(rateLimit).mockResolvedValue({
      ...ALLOWED_RESULT,
      remaining: 299,
    });

    const res = await listingsGET(
      makeRequest("http://localhost/api/v1/listings"),
    );

    expect(res.status).toBe(200);
  });

  // Test 2
  it("blocks the 301st request — returns 429", async () => {
    vi.mocked(rateLimit).mockResolvedValue(BLOCKED_RESULT);

    const res = await listingsGET(
      makeRequest("http://localhost/api/v1/listings"),
    );

    expect(res.status).toBe(429);
  });

  // Test 3
  it("uses publicRead rate limit key — not the listing write key", async () => {
    await listingsGET(makeRequest("http://localhost/api/v1/listings"));

    const [type] = vi.mocked(rateLimit).mock.calls[0]!;
    expect(type).toBe("publicRead");
    expect(type).not.toBe("listing");
  });

  // Test 4
  it("keys rate limit by IP address — not by user ID", async () => {
    await listingsGET(makeRequest("http://localhost/api/v1/listings"));

    const [_type, key] = vi.mocked(rateLimit).mock.calls[0]!;
    expect(key).toContain(TEST_IP);
  });

  // Test 5
  it("429 response body includes retryAfter value", async () => {
    vi.mocked(rateLimit).mockResolvedValue(BLOCKED_RESULT);

    const res = await listingsGET(
      makeRequest("http://localhost/api/v1/listings"),
    );
    const body = (await res.json()) as { retryAfter: number };

    expect(body.retryAfter).toBe(60);
  });
});

// ── Search ────────────────────────────────────────────────────────────────────

describe("Search rate limiting — GET /api/v1/search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rateLimit).mockResolvedValue(ALLOWED_RESULT);
    vi.mocked(getClientIp).mockReturnValue(TEST_IP);
  });

  // Test 6
  it("allows requests within the 60/min limit — returns 200", async () => {
    vi.mocked(rateLimit).mockResolvedValue({
      ...ALLOWED_RESULT,
      remaining: 59,
    });

    const res = await searchGET(
      makeRequest("http://localhost/api/v1/search?q=bikes"),
    );

    expect(res.status).toBe(200);
  });

  // Test 7
  it("blocks the 61st request — returns 429", async () => {
    vi.mocked(rateLimit).mockResolvedValue(BLOCKED_RESULT);

    const res = await searchGET(
      makeRequest("http://localhost/api/v1/search?q=bikes"),
    );

    expect(res.status).toBe(429);
  });

  // Test 8
  it("uses publicSearch rate limit key — not the listing write key", async () => {
    await searchGET(makeRequest("http://localhost/api/v1/search?q=bikes"));

    const [type] = vi.mocked(rateLimit).mock.calls[0]!;
    expect(type).toBe("publicSearch");
    expect(type).not.toBe("listing");
  });

  // Test 9
  it("keys rate limit by IP address — not by user ID", async () => {
    await searchGET(makeRequest("http://localhost/api/v1/search?q=bikes"));

    const [_type, key] = vi.mocked(rateLimit).mock.calls[0]!;
    expect(key).toContain(TEST_IP);
  });
});

// ── Key type isolation ────────────────────────────────────────────────────────

describe("Rate limit key type isolation", () => {
  // Test 10
  it("publicRead and publicSearch keys are distinct from auth/register keys", () => {
    // Compile-time check: if any of these assignments fail TypeScript, the
    // keys have been removed from the union type.
    const authKey: RateLimitKey = "auth";
    const registerKey: RateLimitKey = "register";
    const publicReadKey: RateLimitKey = "publicRead";
    const publicSearchKey: RateLimitKey = "publicSearch";

    expect(authKey).toBe("auth");
    expect(registerKey).toBe("register");

    // Public keys must not collide with auth keys
    expect(publicReadKey).not.toBe(authKey);
    expect(publicReadKey).not.toBe(registerKey);
    expect(publicSearchKey).not.toBe(authKey);
    expect(publicSearchKey).not.toBe(registerKey);

    // Public keys must not collide with each other
    expect(publicReadKey).not.toBe(publicSearchKey);

    // Public keys must not collide with the listing write key
    expect(publicReadKey).not.toBe("listing");
    expect(publicSearchKey).not.toBe("listing");
  });
});
