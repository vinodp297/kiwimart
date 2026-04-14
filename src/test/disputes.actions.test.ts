// src/test/disputes.actions.test.ts
// ─── Tests: disputes.ts server actions ─────────────────────────────────────
// Covers openDispute, uploadDisputeEvidence, respondToDispute, getDisputeEvidenceUrls

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

vi.mock("server-only", () => ({}));

// ── Mock requireUser ──────────────────────────────────────────────────────────
const mockRequireUser = vi.fn().mockResolvedValue({
  id: "user_1",
  email: "test@test.com",
  isAdmin: false,
});
vi.mock("@/server/lib/requireUser", () => ({
  requireUser: (...args: unknown[]) => mockRequireUser(...args),
}));

// ── Mock orderService ─────────────────────────────────────────────────────────
const mockOpenDisputeService = vi.fn().mockResolvedValue(undefined);
vi.mock("@/modules/orders/order.service", () => ({
  orderService: {
    openDispute: (...args: unknown[]) => mockOpenDisputeService(...args),
  },
}));

// ── Mock disputeRepository ────────────────────────────────────────────────────
const mockCountRecentByBuyer = vi.fn().mockResolvedValue(0);
vi.mock("@/modules/disputes/dispute.repository", () => ({
  disputeRepository: {
    countRecentByBuyer: (...args: unknown[]) => mockCountRecentByBuyer(...args),
  },
}));

// ── Mock autoResolutionService ────────────────────────────────────────────────
const mockQueueAutoResolution = vi.fn().mockResolvedValue({
  decision: "AUTO_REFUND",
  score: 80,
  canAutoResolve: true,
});
vi.mock("@/modules/disputes/auto-resolution.service", () => ({
  autoResolutionService: {
    queueAutoResolution: (...args: unknown[]) =>
      mockQueueAutoResolution(...args),
  },
}));

// ── Mock orderRepository ──────────────────────────────────────────────────────
const mockFindWithDisputeContext = vi.fn();
vi.mock("@/modules/orders/order.repository", () => ({
  orderRepository: {
    findWithDisputeContext: (...args: unknown[]) =>
      mockFindWithDisputeContext(...args),
  },
}));

// ── Mock dispute.service ──────────────────────────────────────────────────────
const mockGetDisputeByOrderId = vi.fn();
const mockAddSellerResponse = vi.fn().mockResolvedValue(undefined);
vi.mock("@/server/services/dispute/dispute.service", () => ({
  getDisputeByOrderId: (...args: unknown[]) => mockGetDisputeByOrderId(...args),
  addSellerResponse: (...args: unknown[]) => mockAddSellerResponse(...args),
}));

// ── Mock orderEventService ────────────────────────────────────────────────────
const mockRecordEvent = vi.fn();
vi.mock("@/modules/orders/order-event.service", () => ({
  orderEventService: {
    recordEvent: (...args: unknown[]) => mockRecordEvent(...args),
  },
  ORDER_EVENT_TYPES: {
    DISPUTE_RESPONDED: "DISPUTE_RESPONDED",
  },
  ACTOR_ROLES: {
    SELLER: "SELLER",
  },
}));

// ── Mock notification.service ─────────────────────────────────────────────────
const mockCreateNotification = vi.fn().mockResolvedValue(undefined);
vi.mock("@/modules/notifications/notification.service", () => ({
  createNotification: (...args: unknown[]) => mockCreateNotification(...args),
}));

// ── Mock fire-and-forget ──────────────────────────────────────────────────────
const mockFireAndForget = vi.fn();
vi.mock("@/lib/fire-and-forget", () => ({
  fireAndForget: (...args: unknown[]) => mockFireAndForget(...args),
}));

// ── Mock fileValidation ───────────────────────────────────────────────────────
const mockValidateImageFile = vi.fn().mockReturnValue({ valid: true });
vi.mock("@/server/lib/fileValidation", () => ({
  validateImageFile: (...args: unknown[]) => mockValidateImageFile(...args),
}));

// ── Lazy import after all mocks ───────────────────────────────────────────────
const {
  openDispute,
  uploadDisputeEvidence,
  respondToDispute,
  getDisputeEvidenceUrls,
} = await import("@/server/actions/disputes");

// ── Fixtures ──────────────────────────────────────────────────────────────────

const VALID_OPEN_DISPUTE_INPUT = {
  orderId: "order_1",
  reason: "ITEM_NOT_RECEIVED" as const,
  description: "The item never arrived and tracking shows no movement.",
};

const mockOrder = {
  id: "order_1",
  sellerId: "user_seller",
  buyerId: "user_buyer",
  status: "DISPUTED",
  listing: { title: "Test Item" },
  seller: { displayName: "Bob" },
};

const mockDispute = {
  id: "dispute_1",
  orderId: "order_1",
  sellerStatement: null,
};

// ─────────────────────────────────────────────────────────────────────────────
// openDispute
// ─────────────────────────────────────────────────────────────────────────────

describe("openDispute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue({
      id: "user_1",
      email: "test@test.com",
      isAdmin: false,
    });
    mockCountRecentByBuyer.mockResolvedValue(0);
    mockOpenDisputeService.mockResolvedValue(undefined);
    mockQueueAutoResolution.mockResolvedValue({
      decision: "AUTO_REFUND",
      score: 80,
      canAutoResolve: true,
    });
  });

  it("unauthenticated → returns auth error, service not called", async () => {
    mockRequireUser.mockRejectedValueOnce(
      new Error("Please sign in to continue"),
    );

    const result = await openDispute(VALID_OPEN_DISPUTE_INPUT);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
    expect(mockOpenDisputeService).not.toHaveBeenCalled();
  });

  it("rate limit hit → returns rate limit error", async () => {
    const { rateLimit } = await import("@/server/lib/rateLimit");
    vi.mocked(rateLimit).mockResolvedValueOnce({
      success: false,
      remaining: 0,
      reset: Date.now() + 60_000,
      retryAfter: 60,
    });

    const result = await openDispute(VALID_OPEN_DISPUTE_INPUT);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/too many/i);
    expect(mockOpenDisputeService).not.toHaveBeenCalled();
  });

  it("invalid orderId (empty) → schema error", async () => {
    const result = await openDispute({
      ...VALID_OPEN_DISPUTE_INPUT,
      orderId: "",
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
    expect(mockOpenDisputeService).not.toHaveBeenCalled();
  });

  it("description too short (< 20 chars) → schema error", async () => {
    const result = await openDispute({
      ...VALID_OPEN_DISPUTE_INPUT,
      description: "Too short",
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
    expect(mockOpenDisputeService).not.toHaveBeenCalled();
  });

  it("invalid reason enum → schema error", async () => {
    const result = await openDispute({
      ...VALID_OPEN_DISPUTE_INPUT,
      reason: "INVALID_REASON",
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
    expect(mockOpenDisputeService).not.toHaveBeenCalled();
  });

  it("happy path → calls orderService.openDispute with parsed data + user.id + ip", async () => {
    const result = await openDispute(VALID_OPEN_DISPUTE_INPUT);

    expect(result.success).toBe(true);
    expect(mockOpenDisputeService).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "order_1",
        reason: "ITEM_NOT_RECEIVED",
      }),
      "user_1",
      expect.any(String),
    );
  });

  it("happy path → autoResolutionService.queueAutoResolution is fired", async () => {
    await openDispute(VALID_OPEN_DISPUTE_INPUT);

    // The service calls queueAutoResolution as fire-and-forget (promise chain)
    // Allow microtasks to flush
    await new Promise((r) => setTimeout(r, 0));

    expect(mockQueueAutoResolution).toHaveBeenCalledWith("order_1");
  });

  it("service throws → returns safeActionError", async () => {
    mockOpenDisputeService.mockRejectedValueOnce(
      new Error("Database connection failed"),
    );

    const result = await openDispute(VALID_OPEN_DISPUTE_INPUT);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// respondToDispute
// ─────────────────────────────────────────────────────────────────────────────

describe("respondToDispute", () => {
  const VALID_RESPOND_INPUT = {
    orderId: "order_1",
    response:
      "I have sent the item as described in the listing with photos to prove it.",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue({
      id: "user_seller",
      email: "seller@test.com",
      isAdmin: false,
    });
    mockFindWithDisputeContext.mockResolvedValue(mockOrder);
    mockGetDisputeByOrderId.mockResolvedValue(mockDispute);
    mockAddSellerResponse.mockResolvedValue(undefined);
    mockQueueAutoResolution.mockResolvedValue({
      decision: "MANUAL_REVIEW",
      score: 50,
      canAutoResolve: false,
    });
  });

  it("unauthenticated → auth error", async () => {
    mockRequireUser.mockRejectedValueOnce(
      new Error("Please sign in to continue"),
    );

    const result = await respondToDispute(VALID_RESPOND_INPUT);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
    expect(mockAddSellerResponse).not.toHaveBeenCalled();
  });

  it("response too short → schema error", async () => {
    const result = await respondToDispute({
      ...VALID_RESPOND_INPUT,
      response: "Short",
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
    expect(mockAddSellerResponse).not.toHaveBeenCalled();
  });

  it("order not found → error 'Order not found'", async () => {
    mockFindWithDisputeContext.mockResolvedValueOnce(null);

    const result = await respondToDispute(VALID_RESPOND_INPUT);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/order not found/i);
  });

  it("order.sellerId !== user.id → 'Only the seller can respond'", async () => {
    mockRequireUser.mockResolvedValueOnce({
      id: "different_user",
      email: "other@test.com",
    });

    const result = await respondToDispute(VALID_RESPOND_INPUT);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/only the seller/i);
  });

  it("order.status !== 'DISPUTED' → 'This order is not in a disputed state.'", async () => {
    mockFindWithDisputeContext.mockResolvedValueOnce({
      ...mockOrder,
      status: "DISPATCHED",
    });

    const result = await respondToDispute(VALID_RESPOND_INPUT);

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error).toMatch(/not in a disputed state/i);
  });

  it("no dispute found → 'No dispute found'", async () => {
    mockGetDisputeByOrderId.mockResolvedValueOnce(null);

    const result = await respondToDispute(VALID_RESPOND_INPUT);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/no dispute found/i);
  });

  it("dispute already has sellerStatement → 'You have already responded'", async () => {
    mockGetDisputeByOrderId.mockResolvedValueOnce({
      ...mockDispute,
      sellerStatement: "I already replied previously.",
    });

    const result = await respondToDispute(VALID_RESPOND_INPUT);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/already responded/i);
  });

  it("happy path → calls addSellerResponse with correct args", async () => {
    const result = await respondToDispute(VALID_RESPOND_INPUT);

    expect(result.success).toBe(true);
    expect(mockAddSellerResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        disputeId: "dispute_1",
        sellerId: "user_seller",
        statement: VALID_RESPOND_INPUT.response,
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// uploadDisputeEvidence
// ─────────────────────────────────────────────────────────────────────────────

describe("uploadDisputeEvidence", () => {
  function makeFile(
    name = "photo.jpg",
    type = "image/jpeg",
    size = 1024,
  ): File {
    const content = new Uint8Array(size).fill(0xff);
    return new File([content], name, { type });
  }

  function makeFormData(files: File[]): FormData {
    const fd = new FormData();
    for (const f of files) fd.append("files", f);
    return fd;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue({
      id: "user_1",
      email: "test@test.com",
      isAdmin: false,
    });
    mockValidateImageFile.mockReturnValue({ valid: true });
  });

  it("unauthenticated → auth error", async () => {
    mockRequireUser.mockRejectedValueOnce(
      new Error("Please sign in to continue"),
    );

    const fd = makeFormData([makeFile()]);
    const result = await uploadDisputeEvidence(fd);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
  });

  it("no files → 'No files provided.'", async () => {
    const fd = new FormData();
    const result = await uploadDisputeEvidence(fd);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No files provided.");
  });

  it("file fails validateImageFile → returns validation error", async () => {
    mockValidateImageFile.mockReturnValueOnce({
      valid: false,
      error: "File type not supported.",
    });

    const fd = makeFormData([makeFile("bad.exe", "application/octet-stream")]);
    const result = await uploadDisputeEvidence(fd);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
  });

  it("happy path single file → success with R2 key in urls array", async () => {
    const fd = makeFormData([makeFile("evidence.jpg", "image/jpeg")]);
    const result = await uploadDisputeEvidence(fd);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.urls).toHaveLength(1);
      expect(result.data.urls[0]).toMatch(/^disputes\/user_1\//);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getDisputeEvidenceUrls
// ─────────────────────────────────────────────────────────────────────────────

describe("getDisputeEvidenceUrls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("HTTP URL passed through directly (no signed URL generated)", async () => {
    const urls = await getDisputeEvidenceUrls([
      "https://example.com/evidence/photo.jpg",
    ]);

    expect(urls).toHaveLength(1);
    expect(urls[0]).toBe("https://example.com/evidence/photo.jpg");
  });

  it("R2 key generates signed URL via getSignedUrl", async () => {
    const urls = await getDisputeEvidenceUrls(["disputes/user_1/abc123.jpg"]);

    expect(urls).toHaveLength(1);
    // setup.ts mocks getSignedUrl to return the test-bucket URL
    expect(urls[0]).toContain("test-bucket.r2.example.com");
    expect(urls[0]).toContain("X-Amz-Signature=mock");
  });

  it("mixed list: HTTP URLs pass through, R2 keys get signed", async () => {
    const urls = await getDisputeEvidenceUrls([
      "https://cdn.example.com/legacy.jpg",
      "disputes/user_1/new-evidence.png",
    ]);

    expect(urls).toHaveLength(2);
    expect(urls[0]).toBe("https://cdn.example.com/legacy.jpg");
    expect(urls[1]).toContain("X-Amz-Signature=mock");
  });

  it("empty array → returns empty array", async () => {
    const urls = await getDisputeEvidenceUrls([]);

    expect(urls).toHaveLength(0);
  });
});
