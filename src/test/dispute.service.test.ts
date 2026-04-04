// src/test/dispute.service.test.ts
// ─── Tests for DisputeService ──────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

// ── Mock dispute repository ────────────────────────────────────────────────
vi.mock("@/modules/disputes/dispute.repository", () => ({
  disputeRepository: {
    findByOrderId: vi.fn(),
    findByOrderIdWithEvidence: vi.fn(),
    findByIdWithEvidence: vi.fn(),
    findStatusById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    createManyEvidence: vi.fn(),
    transaction: vi
      .fn()
      .mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({}),
      ),
  },
}));

import {
  createDispute,
  addEvidence,
  addSellerResponse,
  resolveDispute,
  markUnderReview,
  getDisputeByOrderId,
  getDisputeById,
} from "@/server/services/dispute/dispute.service";
import { disputeRepository } from "@/modules/disputes/dispute.repository";
import { logger } from "@/shared/logger";

describe("DisputeService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(disputeRepository.transaction).mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
    );
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 1. DISPUTE OPENING
  // ─────────────────────────────────────────────────────────────────────────

  describe("createDispute", () => {
    it("creates dispute record with OPEN status", async () => {
      vi.mocked(disputeRepository.findByOrderId).mockResolvedValue(null);
      vi.mocked(disputeRepository.create).mockResolvedValue({
        id: "dispute-1",
        orderId: "order-1",
        status: "OPEN",
      } as never);

      const result = await createDispute({
        orderId: "order-1",
        reason: "ITEM_NOT_AS_DESCRIBED" as never,
        source: "BUYER" as never,
        buyerStatement: "Item is broken",
        evidenceKeys: [],
        buyerId: "buyer-1",
        tx: {} as never,
      });

      expect(result.id).toBe("dispute-1");
      expect(disputeRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: "order-1",
          reason: "ITEM_NOT_AS_DESCRIBED",
          source: "BUYER",
          status: "OPEN",
          buyerStatement: "Item is broken",
          openedAt: expect.any(Date),
        }),
        expect.anything(),
      );
    });

    it("fails if dispute already exists for order", async () => {
      vi.mocked(disputeRepository.findByOrderId).mockResolvedValue({
        id: "existing",
      } as never);

      await expect(
        createDispute({
          orderId: "order-1",
          reason: "ITEM_DAMAGED" as never,
          source: "BUYER" as never,
          buyerStatement: null,
          evidenceKeys: [],
          buyerId: "buyer-1",
          tx: {} as never,
        }),
      ).rejects.toThrow("Dispute already exists");
    });

    it("creates evidence records for buyer-submitted evidence", async () => {
      vi.mocked(disputeRepository.findByOrderId).mockResolvedValue(null);
      vi.mocked(disputeRepository.create).mockResolvedValue({
        id: "dispute-1",
      } as never);
      vi.mocked(disputeRepository.createManyEvidence).mockResolvedValue(
        undefined,
      );

      await createDispute({
        orderId: "order-1",
        reason: "ITEM_DAMAGED" as never,
        source: "BUYER" as never,
        buyerStatement: null,
        evidenceKeys: ["img1.jpg", "img2.jpg"],
        buyerId: "buyer-1",
        tx: {} as never,
      });

      expect(disputeRepository.createManyEvidence).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            disputeId: "dispute-1",
            uploadedBy: "BUYER",
            uploaderId: "buyer-1",
            r2Key: "img1.jpg",
            fileType: "image",
          }),
          expect.objectContaining({ r2Key: "img2.jpg" }),
        ]),
        expect.anything(),
      );
    });

    it("skips evidence creation when no keys provided", async () => {
      vi.mocked(disputeRepository.findByOrderId).mockResolvedValue(null);
      vi.mocked(disputeRepository.create).mockResolvedValue({
        id: "dispute-1",
      } as never);

      await createDispute({
        orderId: "order-1",
        reason: "OTHER" as never,
        source: "BUYER" as never,
        buyerStatement: "No evidence",
        evidenceKeys: [],
        buyerId: "buyer-1",
        tx: {} as never,
      });

      expect(disputeRepository.createManyEvidence).not.toHaveBeenCalled();
    });

    it("logs dispute creation with details", async () => {
      vi.mocked(disputeRepository.findByOrderId).mockResolvedValue(null);
      vi.mocked(disputeRepository.create).mockResolvedValue({
        id: "dispute-1",
      } as never);

      await createDispute({
        orderId: "order-1",
        reason: "ITEM_NOT_RECEIVED" as never,
        source: "BUYER" as never,
        buyerStatement: null,
        evidenceKeys: ["ev.jpg"],
        buyerId: "buyer-1",
        tx: {} as never,
      });

      expect(logger.info).toHaveBeenCalledWith(
        "dispute.created",
        expect.objectContaining({
          disputeId: "dispute-1",
          orderId: "order-1",
          reason: "ITEM_NOT_RECEIVED",
          evidenceCount: 1,
        }),
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. SELLER RESPONSE
  // ─────────────────────────────────────────────────────────────────────────

  describe("addSellerResponse", () => {
    it("records seller statement and transitions to SELLER_RESPONDED", async () => {
      vi.mocked(disputeRepository.findStatusById).mockResolvedValue({
        status: "OPEN" as never,
      });
      vi.mocked(disputeRepository.update).mockResolvedValue({} as never);

      await addSellerResponse({
        disputeId: "dispute-1",
        sellerId: "seller-1",
        statement: "Item was as described",
        evidenceKeys: [],
      });

      expect(disputeRepository.update).toHaveBeenCalledWith(
        "dispute-1",
        expect.objectContaining({
          sellerStatement: "Item was as described",
          sellerRespondedAt: expect.any(Date),
          status: "SELLER_RESPONDED",
        }),
        expect.anything(),
      );
    });

    it("fails if dispute not found", async () => {
      vi.mocked(disputeRepository.findStatusById).mockResolvedValue(null);

      await expect(
        addSellerResponse({
          disputeId: "missing",
          sellerId: "seller-1",
          statement: "test",
          evidenceKeys: [],
        }),
      ).rejects.toThrow("Dispute not found");
    });

    it("fails if dispute already resolved", async () => {
      vi.mocked(disputeRepository.findStatusById).mockResolvedValue({
        status: "RESOLVED_BUYER" as never,
      });

      await expect(
        addSellerResponse({
          disputeId: "dispute-1",
          sellerId: "seller-1",
          statement: "too late",
          evidenceKeys: [],
        }),
      ).rejects.toThrow("not in a state that accepts seller responses");
    });

    it("accepts response from AWAITING_SELLER_RESPONSE state", async () => {
      vi.mocked(disputeRepository.findStatusById).mockResolvedValue({
        status: "AWAITING_SELLER_RESPONSE" as never,
      });
      vi.mocked(disputeRepository.update).mockResolvedValue({} as never);

      await addSellerResponse({
        disputeId: "dispute-1",
        sellerId: "seller-1",
        statement: "My response",
        evidenceKeys: [],
      });

      expect(disputeRepository.update).toHaveBeenCalledWith(
        "dispute-1",
        expect.objectContaining({ status: "SELLER_RESPONDED" }),
        expect.anything(),
      );
    });

    it("creates evidence when seller provides keys", async () => {
      vi.mocked(disputeRepository.findStatusById).mockResolvedValue({
        status: "OPEN" as never,
      });
      vi.mocked(disputeRepository.update).mockResolvedValue({} as never);
      vi.mocked(disputeRepository.createManyEvidence).mockResolvedValue(
        undefined,
      );

      await addSellerResponse({
        disputeId: "dispute-1",
        sellerId: "seller-1",
        statement: "Here is proof",
        evidenceKeys: ["seller-proof.jpg"],
      });

      expect(disputeRepository.createManyEvidence).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            disputeId: "dispute-1",
            uploadedBy: "SELLER",
            uploaderId: "seller-1",
            r2Key: "seller-proof.jpg",
          }),
        ]),
        expect.anything(),
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. EVIDENCE UPLOAD
  // ─────────────────────────────────────────────────────────────────────────

  describe("addEvidence", () => {
    it("creates evidence records for buyer uploads", async () => {
      vi.mocked(disputeRepository.createManyEvidence).mockResolvedValue(
        undefined,
      );

      await addEvidence({
        disputeId: "dispute-1",
        r2Keys: ["photo1.jpg"],
        uploadedBy: "BUYER" as never,
        uploaderId: "buyer-1",
      });

      expect(disputeRepository.createManyEvidence).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            disputeId: "dispute-1",
            uploadedBy: "BUYER",
            uploaderId: "buyer-1",
            r2Key: "photo1.jpg",
            fileType: "image",
          }),
        ],
        undefined,
      );
    });

    it("does nothing when no keys provided", async () => {
      await addEvidence({
        disputeId: "dispute-1",
        r2Keys: [],
        uploadedBy: "BUYER" as never,
        uploaderId: "buyer-1",
      });

      expect(disputeRepository.createManyEvidence).not.toHaveBeenCalled();
    });

    it("transitions OPEN dispute to AWAITING_SELLER_RESPONSE for seller evidence", async () => {
      vi.mocked(disputeRepository.createManyEvidence).mockResolvedValue(
        undefined,
      );
      vi.mocked(disputeRepository.findStatusById).mockResolvedValue({
        status: "OPEN" as never,
      });
      vi.mocked(disputeRepository.update).mockResolvedValue({} as never);

      await addEvidence({
        disputeId: "dispute-1",
        r2Keys: ["counter.jpg"],
        uploadedBy: "SELLER" as never,
        uploaderId: "seller-1",
      });

      expect(disputeRepository.update).toHaveBeenCalledWith(
        "dispute-1",
        { status: "AWAITING_SELLER_RESPONSE" },
        undefined,
      );
    });

    it("does not transition non-OPEN dispute for seller evidence", async () => {
      vi.mocked(disputeRepository.createManyEvidence).mockResolvedValue(
        undefined,
      );
      vi.mocked(disputeRepository.findStatusById).mockResolvedValue({
        status: "SELLER_RESPONDED" as never,
      });

      await addEvidence({
        disputeId: "dispute-1",
        r2Keys: ["extra.jpg"],
        uploadedBy: "SELLER" as never,
        uploaderId: "seller-1",
      });

      expect(disputeRepository.update).not.toHaveBeenCalled();
    });

    it("does not transition dispute for buyer evidence", async () => {
      vi.mocked(disputeRepository.createManyEvidence).mockResolvedValue(
        undefined,
      );

      await addEvidence({
        disputeId: "dispute-1",
        r2Keys: ["buyer-extra.jpg"],
        uploadedBy: "BUYER" as never,
        uploaderId: "buyer-1",
      });

      // Buyer uploads should NOT call findStatusById or update
      expect(disputeRepository.findStatusById).not.toHaveBeenCalled();
      expect(disputeRepository.update).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4. DISPUTE RESOLUTION
  // ─────────────────────────────────────────────────────────────────────────

  describe("resolveDispute", () => {
    it("resolves BUYER_WON as RESOLVED_BUYER", async () => {
      vi.mocked(disputeRepository.update).mockResolvedValue({} as never);

      await resolveDispute({
        disputeId: "dispute-1",
        decision: "BUYER_WON",
        refundAmount: 5000,
        adminNotes: "Buyer provided clear evidence",
        resolvedBy: "admin-1",
        tx: {} as never,
      });

      expect(disputeRepository.update).toHaveBeenCalledWith(
        "dispute-1",
        expect.objectContaining({
          status: "RESOLVED_BUYER",
          resolution: "BUYER_WON",
          refundAmount: 5000,
          adminNotes: "Buyer provided clear evidence",
          resolvedAt: expect.any(Date),
        }),
        expect.anything(),
      );
    });

    it("resolves SELLER_WON as RESOLVED_SELLER", async () => {
      vi.mocked(disputeRepository.update).mockResolvedValue({} as never);

      await resolveDispute({
        disputeId: "dispute-1",
        decision: "SELLER_WON",
        resolvedBy: "admin-1",
        tx: {} as never,
      });

      expect(disputeRepository.update).toHaveBeenCalledWith(
        "dispute-1",
        expect.objectContaining({
          status: "RESOLVED_SELLER",
          refundAmount: null,
        }),
        expect.anything(),
      );
    });

    it("resolves PARTIAL as PARTIAL_RESOLUTION", async () => {
      vi.mocked(disputeRepository.update).mockResolvedValue({} as never);

      await resolveDispute({
        disputeId: "dispute-1",
        decision: "PARTIAL",
        refundAmount: 2500,
        resolvedBy: "admin-1",
        tx: {} as never,
      });

      expect(disputeRepository.update).toHaveBeenCalledWith(
        "dispute-1",
        expect.objectContaining({
          status: "PARTIAL_RESOLUTION",
          refundAmount: 2500,
        }),
        expect.anything(),
      );
    });

    it("logs resolution with details", async () => {
      vi.mocked(disputeRepository.update).mockResolvedValue({} as never);

      await resolveDispute({
        disputeId: "dispute-1",
        decision: "BUYER_WON",
        refundAmount: 3000,
        resolvedBy: "admin-1",
        tx: {} as never,
      });

      expect(logger.info).toHaveBeenCalledWith(
        "dispute.resolved",
        expect.objectContaining({
          disputeId: "dispute-1",
          decision: "BUYER_WON",
          resolvedBy: "admin-1",
          refundAmount: 3000,
        }),
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 5. MARK UNDER REVIEW
  // ─────────────────────────────────────────────────────────────────────────

  describe("markUnderReview", () => {
    it("transitions OPEN dispute to UNDER_REVIEW", async () => {
      vi.mocked(disputeRepository.findStatusById).mockResolvedValue({
        status: "OPEN" as never,
      });
      vi.mocked(disputeRepository.update).mockResolvedValue({} as never);

      await markUnderReview("dispute-1");

      expect(disputeRepository.update).toHaveBeenCalledWith("dispute-1", {
        status: "UNDER_REVIEW",
      });
    });

    it("transitions SELLER_RESPONDED to UNDER_REVIEW", async () => {
      vi.mocked(disputeRepository.findStatusById).mockResolvedValue({
        status: "SELLER_RESPONDED" as never,
      });
      vi.mocked(disputeRepository.update).mockResolvedValue({} as never);

      await markUnderReview("dispute-1");

      expect(disputeRepository.update).toHaveBeenCalledWith("dispute-1", {
        status: "UNDER_REVIEW",
      });
    });

    it("transitions AWAITING_SELLER_RESPONSE to UNDER_REVIEW", async () => {
      vi.mocked(disputeRepository.findStatusById).mockResolvedValue({
        status: "AWAITING_SELLER_RESPONSE" as never,
      });
      vi.mocked(disputeRepository.update).mockResolvedValue({} as never);

      await markUnderReview("dispute-1");

      expect(disputeRepository.update).toHaveBeenCalledWith("dispute-1", {
        status: "UNDER_REVIEW",
      });
    });

    it("does not transition resolved dispute", async () => {
      vi.mocked(disputeRepository.findStatusById).mockResolvedValue({
        status: "RESOLVED_BUYER" as never,
      });

      await markUnderReview("dispute-1");

      expect(disputeRepository.update).not.toHaveBeenCalled();
    });

    it("does nothing if dispute not found", async () => {
      vi.mocked(disputeRepository.findStatusById).mockResolvedValue(null);

      await markUnderReview("missing");

      expect(disputeRepository.update).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 6. QUERY HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  describe("getDisputeByOrderId", () => {
    it("returns dispute with evidence", async () => {
      const mockDispute = {
        id: "dispute-1",
        orderId: "order-1",
        evidence: [{ id: "ev-1", r2Key: "photo.jpg" }],
      };
      vi.mocked(disputeRepository.findByOrderIdWithEvidence).mockResolvedValue(
        mockDispute as never,
      );

      const result = await getDisputeByOrderId("order-1");

      expect(result).toEqual(mockDispute);
      expect(disputeRepository.findByOrderIdWithEvidence).toHaveBeenCalledWith(
        "order-1",
      );
    });

    it("returns null if no dispute exists", async () => {
      vi.mocked(disputeRepository.findByOrderIdWithEvidence).mockResolvedValue(
        null,
      );

      const result = await getDisputeByOrderId("order-no-dispute");

      expect(result).toBeNull();
    });
  });

  describe("getDisputeById", () => {
    it("returns dispute by ID with evidence", async () => {
      const mockDispute = { id: "dispute-1", evidence: [] };
      vi.mocked(disputeRepository.findByIdWithEvidence).mockResolvedValue(
        mockDispute as never,
      );

      const result = await getDisputeById("dispute-1");

      expect(result).toEqual(mockDispute);
    });

    it("returns null for non-existent dispute", async () => {
      vi.mocked(disputeRepository.findByIdWithEvidence).mockResolvedValue(null);

      const result = await getDisputeById("nope");

      expect(result).toBeNull();
    });
  });
});
