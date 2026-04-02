// src/server/services/dispute/dispute.service.ts
// ─── Centralised Dispute Service ────────────────────────────────────────────
// All dispute reads and writes go through this service.
// No other file should write directly to the Dispute or DisputeEvidence tables.

import db from "@/lib/db";
import { logger } from "@/shared/logger";
import type {
  Dispute,
  DisputeEvidence,
  DisputeReason,
  DisputeSource,
  DisputeStatus,
  EvidenceUploadedBy,
} from "@prisma/client";

// ── Types ────────────────────────────────────────────────────────────────────

type PrismaTransactionClient = Omit<
  typeof db,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export type DisputeWithEvidence = Dispute & {
  evidence: DisputeEvidence[];
};

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
  const existing = await tx.dispute.findUnique({ where: { orderId } });
  if (existing) throw new Error("Dispute already exists for this order");

  // Create Dispute record
  const dispute = await tx.dispute.create({
    data: {
      orderId,
      reason,
      source,
      status: "OPEN",
      buyerStatement,
      openedAt: new Date(),
    },
  });

  // Create DisputeEvidence records for buyer evidence
  if (evidenceKeys.length > 0) {
    await tx.disputeEvidence.createMany({
      data: evidenceKeys.map((key) => ({
        disputeId: dispute.id,
        uploadedBy: "BUYER" as EvidenceUploadedBy,
        uploaderId: buyerId,
        r2Key: key,
        fileType: "image",
      })),
    });
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
  const { disputeId, r2Keys, uploadedBy, uploaderId, label } = params;
  const client = params.tx ?? db;

  if (r2Keys.length === 0) return;

  await client.disputeEvidence.createMany({
    data: r2Keys.map((key) => ({
      disputeId,
      uploadedBy,
      uploaderId,
      r2Key: key,
      fileType: "image",
      label: label ?? null,
    })),
  });

  // If seller is adding evidence and dispute is OPEN, update status
  if (uploadedBy === "SELLER") {
    const dispute = await client.dispute.findUnique({
      where: { id: disputeId },
      select: { status: true },
    });
    if (dispute?.status === "OPEN") {
      await client.dispute.update({
        where: { id: disputeId },
        data: { status: "AWAITING_SELLER_RESPONSE" },
      });
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

  const dispute = await db.dispute.findUnique({
    where: { id: disputeId },
    select: { status: true },
  });

  if (!dispute) throw new Error("Dispute not found");
  if (
    dispute.status !== "OPEN" &&
    dispute.status !== "AWAITING_SELLER_RESPONSE"
  ) {
    throw new Error("Dispute is not in a state that accepts seller responses");
  }

  await db.$transaction(async (tx) => {
    await tx.dispute.update({
      where: { id: disputeId },
      data: {
        sellerStatement: statement,
        sellerRespondedAt: new Date(),
        status: "SELLER_RESPONDED",
      },
    });

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

  await tx.dispute.update({
    where: { id: disputeId },
    data: {
      status: newStatus,
      resolution: decision,
      refundAmount: refundAmount ?? null,
      adminNotes: adminNotes ?? null,
      resolvedAt: new Date(),
    },
  });

  logger.info("dispute.resolved", {
    disputeId,
    decision,
    resolvedBy,
    refundAmount,
  });
}

// ── markUnderReview ──────────────────────────────────────────────────────────

export async function markUnderReview(disputeId: string): Promise<void> {
  const dispute = await db.dispute.findUnique({
    where: { id: disputeId },
    select: { status: true },
  });

  if (!dispute) return;

  // Only move to UNDER_REVIEW from states where admin hasn't yet reviewed
  const reviewableStates: DisputeStatus[] = [
    "OPEN",
    "AWAITING_SELLER_RESPONSE",
    "SELLER_RESPONDED",
  ];
  if (!reviewableStates.includes(dispute.status)) return;

  await db.dispute.update({
    where: { id: disputeId },
    data: { status: "UNDER_REVIEW" },
  });

  logger.info("dispute.under_review", { disputeId });
}

// ── setAutoResolving ─────────────────────────────────────────────────────────

export async function setAutoResolving(
  disputeId: string,
  score: number,
  reason: string,
): Promise<void> {
  await db.dispute.update({
    where: { id: disputeId },
    data: {
      status: "AUTO_RESOLVING",
      autoResolutionScore: score,
      autoResolutionReason: reason,
    },
  });
}

// ── getDisputeByOrderId ──────────────────────────────────────────────────────

export async function getDisputeByOrderId(
  orderId: string,
): Promise<DisputeWithEvidence | null> {
  return db.dispute.findUnique({
    where: { orderId },
    include: { evidence: { orderBy: { createdAt: "asc" } } },
  });
}

// ── getDisputeById ───────────────────────────────────────────────────────────

export async function getDisputeById(
  disputeId: string,
): Promise<DisputeWithEvidence | null> {
  return db.dispute.findUnique({
    where: { id: disputeId },
    include: { evidence: { orderBy: { createdAt: "asc" } } },
  });
}
