// src/test/offers.actions.test.ts
// ─── Tests: offers.ts (createOffer, respondOffer) ────────────────────────────
//
// This file covers the server-action thin layer over offerService.
// It validates:
//   A  Auth guard — requireUser throwing → action surfaces error
//   B  Schema validation — invalid input → { success: false } before service call
//   C  Happy paths — valid input → delegates to offerService, returns success
//   D  Error handling — service throwing / rate-limit hit → action surfaces error

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// ── Mock requireUser ──────────────────────────────────────────────────────────
const mockRequireUser = vi.fn().mockResolvedValue({
  id: "user_buyer",
  email: "buyer@test.com",
  isAdmin: false,
});
vi.mock("@/server/lib/requireUser", () => ({
  requireUser: (...args: unknown[]) => mockRequireUser(...args),
}));

// ── Mock offerService ─────────────────────────────────────────────────────────
const mockCreateOffer = vi.fn().mockResolvedValue({ offerId: "offer_abc123" });
const mockRespondOffer = vi.fn().mockResolvedValue(undefined);

vi.mock("@/modules/offers/offer.service", () => ({
  offerService: {
    createOffer: (...args: unknown[]) => mockCreateOffer(...args),
    respondOffer: (...args: unknown[]) => mockRespondOffer(...args),
  },
}));

// ── Lazy import after mocks ───────────────────────────────────────────────────
const { createOffer, respondOffer } = await import("@/server/actions/offers");

// ── Valid input fixtures ──────────────────────────────────────────────────────
const VALID_CREATE_OFFER = {
  listingId: "listing_xyz",
  amount: 50,
  note: "Happy to pay quickly.",
};

const VALID_RESPOND_OFFER = {
  offerId: "offer_abc123",
  action: "ACCEPT" as const,
};

// ─────────────────────────────────────────────────────────────────────────────
// GROUP A — Auth guard
// ─────────────────────────────────────────────────────────────────────────────

describe("Auth guard — both actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue({
      id: "user_buyer",
      email: "buyer@test.com",
    });
  });

  it("createOffer — unauthenticated → returns auth error without calling service", async () => {
    mockRequireUser.mockRejectedValueOnce(
      new Error("Please sign in to continue"),
    );

    const result = await createOffer(VALID_CREATE_OFFER);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
    expect(mockCreateOffer).not.toHaveBeenCalled();
  });

  it("respondOffer — unauthenticated → returns auth error without calling service", async () => {
    mockRequireUser.mockRejectedValueOnce(
      new Error("Please sign in to continue"),
    );

    const result = await respondOffer(VALID_RESPOND_OFFER);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
    expect(mockRespondOffer).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP B — Schema validation
// ─────────────────────────────────────────────────────────────────────────────

describe("createOffer — schema validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue({
      id: "user_buyer",
      email: "buyer@test.com",
    });
  });

  it("missing listingId → returns validation error with fieldErrors", async () => {
    const result = await createOffer({ ...VALID_CREATE_OFFER, listingId: "" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeTruthy();
      expect(result.fieldErrors).toBeDefined();
    }
    expect(mockCreateOffer).not.toHaveBeenCalled();
  });

  it("negative amount → returns validation error", async () => {
    const result = await createOffer({ ...VALID_CREATE_OFFER, amount: -5 });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
    expect(mockCreateOffer).not.toHaveBeenCalled();
  });

  it("amount exceeds max (100,000) → returns validation error", async () => {
    const result = await createOffer({
      ...VALID_CREATE_OFFER,
      amount: 150_000,
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
    expect(mockCreateOffer).not.toHaveBeenCalled();
  });

  it("note exceeds 300 chars → returns validation error", async () => {
    const result = await createOffer({
      ...VALID_CREATE_OFFER,
      note: "x".repeat(301),
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
    expect(mockCreateOffer).not.toHaveBeenCalled();
  });

  it("non-object payload → returns validation error", async () => {
    const result = await createOffer(null);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
    expect(mockCreateOffer).not.toHaveBeenCalled();
  });
});

describe("respondOffer — schema validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue({
      id: "user_seller",
      email: "seller@test.com",
    });
  });

  it("missing offerId → returns validation error without calling service", async () => {
    const result = await respondOffer({ ...VALID_RESPOND_OFFER, offerId: "" });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
    expect(mockRespondOffer).not.toHaveBeenCalled();
  });

  it("invalid action value → returns validation error", async () => {
    const result = await respondOffer({
      ...VALID_RESPOND_OFFER,
      action: "IGNORE",
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
    expect(mockRespondOffer).not.toHaveBeenCalled();
  });

  it("declineReason exceeds 300 chars → returns validation error", async () => {
    const result = await respondOffer({
      offerId: "offer_abc123",
      action: "DECLINE",
      declineReason: "x".repeat(301),
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
    expect(mockRespondOffer).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP C — Happy paths
// ─────────────────────────────────────────────────────────────────────────────

describe("createOffer — happy path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue({
      id: "user_buyer",
      email: "buyer@test.com",
    });
    mockCreateOffer.mockResolvedValue({ offerId: "offer_abc123" });
  });

  it("valid input → delegates to offerService.createOffer with userId and ip", async () => {
    const result = await createOffer(VALID_CREATE_OFFER);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.offerId).toBe("offer_abc123");
    expect(mockCreateOffer).toHaveBeenCalledWith(
      expect.objectContaining({
        listingId: "listing_xyz",
        amount: 50,
      }),
      "user_buyer",
      expect.any(String),
    );
  });

  it("optional note is passed through to service when provided", async () => {
    const result = await createOffer({
      ...VALID_CREATE_OFFER,
      note: "Please consider.",
    });

    expect(result.success).toBe(true);
    expect(mockCreateOffer).toHaveBeenCalledWith(
      expect.objectContaining({ note: "Please consider." }),
      "user_buyer",
      expect.any(String),
    );
  });

  it("note field is absent when not provided → service still called", async () => {
    const result = await createOffer({
      listingId: "listing_xyz",
      amount: 75,
    });

    expect(result.success).toBe(true);
    expect(mockCreateOffer).toHaveBeenCalledOnce();
  });
});

describe("respondOffer — happy path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue({
      id: "user_seller",
      email: "seller@test.com",
    });
    mockRespondOffer.mockResolvedValue(undefined);
  });

  it("ACCEPT — delegates to offerService.respondOffer with userId and ip", async () => {
    const result = await respondOffer(VALID_RESPOND_OFFER);

    expect(result.success).toBe(true);
    expect(mockRespondOffer).toHaveBeenCalledWith(
      expect.objectContaining({ offerId: "offer_abc123", action: "ACCEPT" }),
      "user_seller",
      expect.any(String),
    );
  });

  it("DECLINE with reason — declineReason forwarded to service", async () => {
    const result = await respondOffer({
      offerId: "offer_abc123",
      action: "DECLINE",
      declineReason: "Price is too low.",
    });

    expect(result.success).toBe(true);
    expect(mockRespondOffer).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "DECLINE",
        declineReason: "Price is too low.",
      }),
      "user_seller",
      expect.any(String),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP D — Error handling
// ─────────────────────────────────────────────────────────────────────────────

describe("createOffer — error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue({
      id: "user_buyer",
      email: "buyer@test.com",
    });
  });

  it("service throws AppError → action surfaces human-readable error", async () => {
    mockCreateOffer.mockRejectedValueOnce(
      Object.assign(new Error("This seller is not accepting offers."), {
        code: "VALIDATION_ERROR",
      }),
    );

    const result = await createOffer(VALID_CREATE_OFFER);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
  });

  it("service throws generic error → action returns safe fallback message", async () => {
    mockCreateOffer.mockRejectedValueOnce(
      new Error("Database connection lost"),
    );

    const result = await createOffer(VALID_CREATE_OFFER);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
  });

  it("rate-limited → returns retryAfter error without calling offerService.createOffer", async () => {
    const { rateLimit } = await import("@/server/lib/rateLimit");
    vi.mocked(rateLimit).mockResolvedValueOnce({
      success: false,
      remaining: 0,
      reset: Date.now() + 60_000,
      retryAfter: 30,
    });

    const result = await createOffer(VALID_CREATE_OFFER);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/30/);
    }
    expect(mockCreateOffer).not.toHaveBeenCalled();
  });

  it("never throws — always returns ActionResult shape", async () => {
    mockCreateOffer.mockRejectedValueOnce(new Error("Unexpected failure"));

    const result = await createOffer(VALID_CREATE_OFFER);

    expect(result).toHaveProperty("success", false);
    expect(() => result).not.toThrow();
  });
});

describe("respondOffer — error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue({
      id: "user_seller",
      email: "seller@test.com",
    });
  });

  it("service throws AppError → action surfaces human-readable error", async () => {
    mockRespondOffer.mockRejectedValueOnce(
      Object.assign(new Error("Offer has already expired."), {
        code: "OFFER_EXPIRED",
      }),
    );

    const result = await respondOffer(VALID_RESPOND_OFFER);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
  });

  it("service throws generic error → action returns safe fallback message", async () => {
    mockRespondOffer.mockRejectedValueOnce(new Error("Redis timeout"));

    const result = await respondOffer(VALID_RESPOND_OFFER);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
  });

  it("never throws — always returns ActionResult shape", async () => {
    mockRespondOffer.mockRejectedValueOnce(new Error("Unexpected failure"));

    const result = await respondOffer(VALID_RESPOND_OFFER);

    expect(result).toHaveProperty("success", false);
    expect(() => result).not.toThrow();
  });
});
