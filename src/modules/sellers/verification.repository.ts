// src/modules/sellers/verification.repository.ts
// ─── Verification Repository — data access for seller verification ────────────

import { getClient, type DbClient } from "@/lib/db";
import { VerificationStatus } from "@prisma/client";

export const verificationRepository = {
  /** Reject all pending verification applications for a user (used when admin rejects ID). */
  async rejectPendingByUser(
    sellerId: string,
    reviewedBy: string,
    adminNotes: string,
    tx?: DbClient,
  ): Promise<void> {
    const client = getClient(tx);
    await client.verificationApplication.updateMany({
      where: { sellerId, status: "PENDING" },
      data: {
        status: "REJECTED",
        reviewedAt: new Date(),
        reviewedBy,
        adminNotes,
      },
    });
  },

  /** Find a pending verification application for review eligibility check. */
  async findPendingStatusBySeller(sellerId: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.verificationApplication.findUnique({
      where: { sellerId },
      select: { status: true },
    });
  },

  /** Upsert a verification application (apply / reapply). */
  async upsertApplication(sellerId: string, tx?: DbClient): Promise<void> {
    const client = getClient(tx);
    await client.verificationApplication.upsert({
      where: { sellerId },
      create: { sellerId, status: "PENDING" },
      update: {
        status: "PENDING",
        appliedAt: new Date(),
        reviewedAt: null,
        reviewedBy: null,
        adminNotes: null,
      },
    });
  },

  /** Find a verification application by seller for admin review. */
  async findForReview(sellerId: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.verificationApplication.findUnique({
      where: { sellerId },
      select: { id: true, status: true },
    });
  },

  /** Update a verification application with admin decision. */
  async updateDecision(
    sellerId: string,
    data: {
      status: VerificationStatus;
      reviewedAt: Date;
      reviewedBy: string;
      adminNotes: string | null | undefined;
    },
    tx?: DbClient,
  ): Promise<void> {
    const client = getClient(tx);
    await client.verificationApplication.update({
      where: { sellerId },
      data,
    });
  },

  /** Find application status for document submission check. */
  async findStatusBySeller(sellerId: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.verificationApplication.findUnique({
      where: { sellerId },
      select: { status: true },
    });
  },

  /** Upsert an application with document keys. */
  async upsertWithDocuments(
    sellerId: string,
    data: {
      documentType: string;
      documentFrontKey: string;
      documentBackKey: string | null;
      selfieKey: string | null;
    },
    tx?: DbClient,
  ): Promise<void> {
    const client = getClient(tx);
    await client.verificationApplication.upsert({
      where: { sellerId },
      create: {
        sellerId,
        status: "PENDING",
        ...data,
      },
      update: {
        status: "PENDING",
        appliedAt: new Date(),
        reviewedAt: null,
        reviewedBy: null,
        adminNotes: null,
        ...data,
      },
    });
  },
};
