// src/modules/sellers/verification.repository.ts
// ─── Verification Repository — data access for seller verification ────────────

import db from "@/lib/db";
import { Prisma, VerificationStatus } from "@prisma/client";

type DbClient = Prisma.TransactionClient | typeof db;

export const verificationRepository = {
  /** Reject all pending verification applications for a user (used when admin rejects ID).
   * @source src/server/actions/seller.ts — rejectIdVerification */
  async rejectPendingByUser(
    sellerId: string,
    reviewedBy: string,
    adminNotes: string,
    tx?: DbClient,
  ): Promise<void> {
    const client = tx ?? db;
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

  /** Find a pending verification application for review eligibility check.
   * @source src/server/actions/verification.application.ts — applyForVerification */
  async findPendingStatusBySeller(sellerId: string, tx?: DbClient) {
    const client = tx ?? db;
    return client.verificationApplication.findUnique({
      where: { sellerId },
      select: { status: true },
    });
  },

  /** Upsert a verification application (apply / reapply).
   * @source src/server/actions/verification.application.ts — applyForVerification */
  async upsertApplication(sellerId: string, tx?: DbClient): Promise<void> {
    const client = tx ?? db;
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

  /** Find a verification application by seller for admin review.
   * @source src/server/actions/verification.application.ts — reviewVerificationApplication */
  async findForReview(sellerId: string, tx?: DbClient) {
    const client = tx ?? db;
    return client.verificationApplication.findUnique({
      where: { sellerId },
      select: { id: true, status: true },
    });
  },

  /** Update a verification application with admin decision.
   * @source src/server/actions/verification.application.ts — reviewVerificationApplication */
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
    const client = tx ?? db;
    await client.verificationApplication.update({
      where: { sellerId },
      data,
    });
  },

  /** Find application status for document submission check.
   * @source src/server/actions/verification.documents.ts — submitIdVerification */
  async findStatusBySeller(sellerId: string, tx?: DbClient) {
    const client = tx ?? db;
    return client.verificationApplication.findUnique({
      where: { sellerId },
      select: { status: true },
    });
  },

  /** Upsert an application with document keys.
   * @source src/server/actions/verification.documents.ts — submitIdVerification */
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
    const client = tx ?? db;
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
