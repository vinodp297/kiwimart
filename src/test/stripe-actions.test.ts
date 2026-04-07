// src/test/stripe-actions.test.ts
// ─── Tests: Stripe Connect Server Actions ───────────────────────────────────
// Covers:
//   createStripeConnectAccount — eligibility, idempotency, Stripe API errors
//   getStripeOnboardingUrl — missing account, already onboarded
//   getStripeAccountStatus — live status sync, no account

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

// ── Mock requireUser ──────────────────────────────────────────────────────────
const mockRequireUser = vi.fn();
vi.mock("@/server/lib/requireUser", () => ({
  requireUser: mockRequireUser,
}));

// ── Mock Stripe with accounts + accountLinks ──────────────────────────────────
const mockAccountsCreate = vi.fn();
const mockAccountsRetrieve = vi.fn();
const mockAccountLinksCreate = vi.fn();

vi.mock("@/infrastructure/stripe/client", () => ({
  stripe: {
    accounts: {
      create: (...args: unknown[]) => mockAccountsCreate(...args),
      retrieve: (...args: unknown[]) => mockAccountsRetrieve(...args),
    },
    accountLinks: {
      create: (...args: unknown[]) => mockAccountLinksCreate(...args),
    },
  },
}));

// ── Mock user repository ────────────────────────────────────────────────────
vi.mock("@/modules/users/user.repository", () => ({
  userRepository: {
    findForStripeConnect: vi.fn(),
    findStripeStatus: vi.fn(),
    update: vi.fn().mockResolvedValue(undefined),
    findEmailVerified: vi.fn().mockResolvedValue({ emailVerified: new Date() }),
  },
}));

// ── Lazy imports ──────────────────────────────────────────────────────────────
const {
  createStripeConnectAccount,
  getStripeOnboardingUrl,
  getStripeAccountStatus,
} = await import("@/server/actions/stripe");
const { userRepository } = await import("@/modules/users/user.repository");

// ── Helpers ───────────────────────────────────────────────────────────────────

const TEST_SELLER = {
  id: "seller-1",
  email: "seller@buyzi.test",
  isAdmin: false,
  isSellerEnabled: true,
  isStripeOnboarded: false,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("createStripeConnectAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_SELLER);
    vi.mocked(userRepository.findForStripeConnect).mockResolvedValue({
      id: "seller-1",
      stripeAccountId: null,
      isStripeOnboarded: false,
      isSellerEnabled: true,
      email: "seller@buyzi.test",
      displayName: "Test Seller",
    } as never);
    mockAccountsCreate.mockResolvedValue({ id: "acct_test_new" });
    mockAccountLinksCreate.mockResolvedValue({
      url: "https://connect.stripe.com/onboarding/test",
    });
  });

  it("creates Stripe Connect account for eligible seller", async () => {
    const result = await createStripeConnectAccount();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.onboardingUrl).toContain("stripe.com");
    }
    expect(mockAccountsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "express",
        country: "NZ",
        email: "seller@buyzi.test",
      }),
    );
    expect(userRepository.update).toHaveBeenCalledWith("seller-1", {
      stripeAccountId: "acct_test_new",
    });
  });

  it("returns onboarding URL for incomplete existing account", async () => {
    vi.mocked(userRepository.findForStripeConnect).mockResolvedValue({
      id: "seller-1",
      stripeAccountId: "acct_existing",
      isStripeOnboarded: false, // Not complete
      isSellerEnabled: true,
      email: "seller@buyzi.test",
      displayName: "Test Seller",
    } as never);

    const result = await createStripeConnectAccount();

    expect(result.success).toBe(true);
    // Should NOT create a new account
    expect(mockAccountsCreate).not.toHaveBeenCalled();
    // Should create a new onboarding link for the existing account
    expect(mockAccountLinksCreate).toHaveBeenCalledWith(
      expect.objectContaining({ account: "acct_existing" }),
    );
  });

  it("rejects if seller not enabled", async () => {
    vi.mocked(userRepository.findForStripeConnect).mockResolvedValue({
      id: "seller-1",
      stripeAccountId: null,
      isStripeOnboarded: false,
      isSellerEnabled: false,
      email: "seller@buyzi.test",
      displayName: "Test Seller",
    } as never);

    const result = await createStripeConnectAccount();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/seller.*enabled/i);
    }
  });

  it("rejects if already fully onboarded", async () => {
    vi.mocked(userRepository.findForStripeConnect).mockResolvedValue({
      id: "seller-1",
      stripeAccountId: "acct_done",
      isStripeOnboarded: true,
      isSellerEnabled: true,
      email: "seller@buyzi.test",
      displayName: "Test Seller",
    } as never);

    const result = await createStripeConnectAccount();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/already connected|already.*active/i);
    }
  });

  it("handles Stripe API error gracefully", async () => {
    mockAccountsCreate.mockRejectedValue(new Error("Stripe API down"));

    const result = await createStripeConnectAccount();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/couldn't connect|try again/i);
    }
  });

  it("returns error if user not found", async () => {
    vi.mocked(userRepository.findForStripeConnect).mockResolvedValue(null);

    const result = await createStripeConnectAccount();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/not found/i);
    }
  });
});

describe("getStripeOnboardingUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_SELLER);
    mockAccountLinksCreate.mockResolvedValue({
      url: "https://connect.stripe.com/onboarding/refresh",
    });
  });

  it("returns onboarding URL for incomplete account", async () => {
    vi.mocked(userRepository.findStripeStatus).mockResolvedValue({
      stripeAccountId: "acct_incomplete",
      isStripeOnboarded: false,
    } as never);

    const result = await getStripeOnboardingUrl();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.onboardingUrl).toContain("stripe.com");
    }
  });

  it("rejects if no Stripe account exists", async () => {
    vi.mocked(userRepository.findStripeStatus).mockResolvedValue({
      stripeAccountId: null,
      isStripeOnboarded: false,
    } as never);

    const result = await getStripeOnboardingUrl();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/no stripe account|create one/i);
    }
  });

  it("rejects if already fully onboarded", async () => {
    vi.mocked(userRepository.findStripeStatus).mockResolvedValue({
      stripeAccountId: "acct_done",
      isStripeOnboarded: true,
    } as never);

    const result = await getStripeOnboardingUrl();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/already.*onboarded/i);
    }
  });
});

describe("getStripeAccountStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue(TEST_SELLER);
  });

  it("returns correct status when charges and payouts enabled", async () => {
    vi.mocked(userRepository.findStripeStatus).mockResolvedValue({
      stripeAccountId: "acct_full",
      isStripeOnboarded: true,
    } as never);
    mockAccountsRetrieve.mockResolvedValue({
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
    });

    const result = await getStripeAccountStatus();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        hasAccount: true,
        onboarded: true,
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
      });
    }
  });

  it("returns restricted status when charges disabled", async () => {
    vi.mocked(userRepository.findStripeStatus).mockResolvedValue({
      stripeAccountId: "acct_restricted",
      isStripeOnboarded: false,
    } as never);
    mockAccountsRetrieve.mockResolvedValue({
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: true,
    });

    const result = await getStripeAccountStatus();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.chargesEnabled).toBe(false);
      expect(result.data.onboarded).toBe(false);
    }
  });

  it("returns no-account status when no Stripe ID", async () => {
    vi.mocked(userRepository.findStripeStatus).mockResolvedValue({
      stripeAccountId: null,
      isStripeOnboarded: false,
    } as never);

    const result = await getStripeAccountStatus();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        hasAccount: false,
        onboarded: false,
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
      });
    }
  });

  it("syncs onboarded status when it changes", async () => {
    vi.mocked(userRepository.findStripeStatus).mockResolvedValue({
      stripeAccountId: "acct_sync",
      isStripeOnboarded: false, // DB says not onboarded
    } as never);
    mockAccountsRetrieve.mockResolvedValue({
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true, // Stripe says onboarded
    });

    await getStripeAccountStatus();

    // Should update DB to match Stripe
    expect(userRepository.update).toHaveBeenCalledWith(TEST_SELLER.id, {
      isStripeOnboarded: true,
    });
  });

  it("handles Stripe API error gracefully", async () => {
    vi.mocked(userRepository.findStripeStatus).mockResolvedValue({
      stripeAccountId: "acct_error",
      isStripeOnboarded: false,
    } as never);
    mockAccountsRetrieve.mockRejectedValue(new Error("Stripe down"));

    const result = await getStripeAccountStatus();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/couldn't|try again/i);
    }
  });
});
