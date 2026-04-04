// src/server/services/dispute/dispute.service.ts
// ─── Centralised Dispute Service ────────────────────────────────────────────
// All dispute reads and writes go through this service.
// No other file should write directly to the Dispute or DisputeEvidence tables.

import { disputeRepository } from "@/modules/disputes/dispute.repository";
import type { DisputeWithEvidence } from "@/modules/disputes/dispute.repository";
import { logger } from "@/shared/logger";
import type {
  Dispute,
  DisputeReason,
  DisputeSource,
  DisputeStatus,
  EvidenceUploadedBy,
} from "@prisma/client";

// ── Types ────────────────────────────────────────────────────────────────────

type PrismaTransactionClient = Parameters<
  Parameters<typeof disputeRepository.transaction>[0]
>[0];

export type { DisputeWithEvidence };

// ── createDispute ────────────────────────────────────────────────────────────

export async function createDispute(params: {
  orderId: string;
  reason: DisputeReason;
  source: DisputeSource;
  buyerStatement: string | null;
  evidenceKeys: string[];
  buyerId: string;
  tx: PrismaTransactionClient;
}): Promise<Dispute> {
  const { orderId, reason, source, buyerStatement, evidenceKeys, buyerId, tx } =
    params;

  // Check no dispute already exists for this order
  const existing = await disputeRepository.findByOrderId(orderId, tx);
  if (existing) throw new Error("Dispute already exists for this order");

  // Create Dispute record
  const dispute = await disputeRepository.create(
    {
      orderId,
      reason,
      source,
      status: "OPEN",
      buyerStatement,
      openedAt: new Date(),
    },
    tx,
  );

  // Create DisputeEvidence records for buyer evidence
  if (evidenceKeys.length > 0) {
    await disputeRepository.createManyEvidence(
      evidenceKeys.map((key) => ({
        disputeId: dispute.id,
        uploadedBy: "BUYER" as EvidenceUploadedBy,
        uploaderId: buyerId,
        r2Key: key,
        fileType: "image",
      })),
      tx,
    );
  }

  logger.info("dispute.created", {
    disputeId: dispute.id,
    orderId,
    reason,
    source,
    evidenceCount: evidenceKeys.length,
  });

  return dispute;
}

// ── addEvidence ──────────────────────────────────────────────────────────────

export async function addEvidence(params: {
  disputeId: string;
  r2Keys: string[];
  uploadedBy: EvidenceUploadedBy;
  uploaderId: string;
  label?: string;
  tx?: PrismaTransactionClient;
}): Promise<void> {
  const { disputeId, r2Keys, uploadedBy, uploaderId, label, tx } = params;

  if (r2Keys.length === 0) return;

  await disputeRepository.createManyEvidence(
    r2Keys.map((key) => ({
      disputeId,
      uploadedBy,
      uploaderId,
      r2Key: key,
      fileType: "image",
      label: label ?? null,
    })),
    tx,
  );

  // If seller is adding evidence and dispute is OPEN, update status
  if (uploadedBy === "SELLER") {
    const dispute = await disputeRepository.findStatusById(disputeId, tx);
    if (dispute?.status === "OPEN") {
      await disputeRepository.update(
        disputeId,
        { status: "AWAITING_SELLER_RESPONSE" },
        tx,
      );
    }
  }

  logger.info("dispute.evidence.added", {
    disputeId,
    uploadedBy,
    count: r2Keys.length,
  });
}

// ── addSellerResponse ────────────────────────────────────────────────────────

export async function addSellerResponse(params: {
  disputeId: string;
  sellerId: string;
  statement: string;
  evidenceKeys: string[];
}): Promise<void> {
  const { disputeId, sellerId, statement, evidenceKeys } = params;

  const dispute = await disputeRepository.findStatusById(disputeId);

  if (!dispute) throw new Error("Dispute not found");
  if (
    dispute.status !== "OPEN" &&
    dispute.status !== "AWAITING_SELLER_RESPONSE"
  ) {
    throw new Error("Dispute is not in a state that accepts seller responses");
  }

  await disputeRepository.transaction(async (tx) => {
    await disputeRepository.update(
      disputeId,
      {
        sellerStatement: statement,
        sellerRespondedAt: new Date(),
        status: "SELLER_RESPONDED",
      },
      tx,
    );

    if (evidenceKeys.length > 0) {
      await addEvidence({
        disputeId,
        r2Keys: evidenceKeys,
        uploadedBy: "SELLER",
        uploaderId: sellerId,
        tx,
      });
    }
  });

  logger.info("dispute.seller_responded", { disputeId, sellerId });
}

// ── resolveDispute ───────────────────────────────────────────────────────────

export async function resolveDispute(params: {
  disputeId: string;
  decision: "BUYER_WON" | "SELLER_WON" | "PARTIAL";
  refundAmount?: number;
  adminNotes?: string;
  resolvedBy: string;
  tx: PrismaTransactionClient;
}): Promise<void> {
  const { disputeId, decision, refundAmount, adminNotes, resolvedBy, tx } =
    params;

  // Map decision to DisputeStatus
  const statusMap: Record<string, DisputeStatus> = {
    BUYER_WON: "RESOLVED_BUYER",
    SELLER_WON: "RESOLVED_SELLER",
    PARTIAL: "PARTIAL_RESOLUTION",
  };

  const newStatus = statusMap[decision] ?? "RESOLVED_BUYER";

  await disputeRepository.update(
    disputeId,
    {
      status: newStatus,
      resolution: decision,
      refundAmount: refundAmount ?? null,
      adminNotes: adminNotes ?? null,
      resolvedAt: new Date(),
    },
    tx,
  );

  logger.info("dispute.resolved", {
    disputeId,
    decision,
    resolvedBy,
    refundAmount,
  });
}

// ── markUnderReview ──────────────────────────────────────────────────────────

export async function markUnderReview(disputeId: string): Promise<void> {
  const dispute = await disputeRepository.findStatusById(disputeId);

  if (!dispute) return;

  // Only move to UNDER_REVIEW from states where admin hasn't yet reviewed
  const reviewableStates: DisputeStatus[] = [
    "OPEN",
    "AWAITING_SELLER_RESPONSE",
    "SELLER_RESPONDED",
  ];
  if (!reviewableStates.includes(dispute.status)) return;

  await disputeRepository.update(disputeId, { status: "UNDER_REVIEW" });

  logger.info("dispute.under_review", { disputeId });
}

// ── setAutoResolving ─────────────────────────────────────────────────────────

export async function setAutoResolving(
  disputeId: string,
  score: number,
  reason: string,
): Promise<void> {
  await disputeRepository.update(disputeId, {
    status: "AUTO_RESOLVING",
    autoResolutionScore: score,
    autoResolutionReason: reason,
  });
}

// ── getDisputeByOrderId ──────────────────────────────────────────────────────

export async function getDisputeByOrderId(
  orderId: string,
): Promise<DisputeWithEvidence | null> {
  return disputeRepository.findByOrderIdWithEvidence(orderId);
}

// ── getDisputeById ───────────────────────────────────────────────────────────

export async function getDisputeById(
  disputeId: string,
): Promise<DisputeWithEvidence | null> {
  return disputeRepository.findByIdWithEvidence(disputeId);
}
