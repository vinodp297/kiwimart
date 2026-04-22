// src/modules/users/user-auth.repository.ts
// ─── Auth-specific token + session + MFA write methods ────────────────────────

import db, { getClient, type DbClient } from "@/lib/db";
import { Prisma } from "@prisma/client";

export const userAuthRepository = {
  async deleteAllSessions(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = getClient(tx);
    await client.session.deleteMany({ where: { userId } });
  },

  async invalidatePendingResetTokens(userId: string): Promise<void> {
    await db.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    });
  },

  async createResetToken(data: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    requestIp: string | null;
    userAgent: string | null;
  }): Promise<void> {
    await db.passwordResetToken.create({ data });
  },

  async findResetTokenWithUser(tokenHash: string): Promise<{
    id: string;
    userId: string;
    usedAt: Date | null;
    expiresAt: Date;
    user: { id: string; email: string; displayName: string | null };
  } | null> {
    return db.passwordResetToken.findUnique({
      where: { tokenHash },
      include: {
        user: { select: { id: true, email: true, displayName: true } },
      },
    });
  },

  async storeMfaSetup(
    userId: string,
    data: { mfaSecret: string; mfaBackupCodes: string },
  ): Promise<void> {
    await db.user.update({
      where: { id: userId },
      data: { ...data, isMfaEnabled: false },
    });
  },

  async enableMfa(userId: string): Promise<void> {
    await db.user.update({
      where: { id: userId },
      data: { isMfaEnabled: true },
    });
  },

  async updateMfaBackupCodes(
    userId: string,
    encryptedCodes: string,
  ): Promise<void> {
    await db.user.update({
      where: { id: userId },
      data: { mfaBackupCodes: encryptedCodes },
    });
  },

  async clearMfa(userId: string): Promise<void> {
    await db.user.update({
      where: { id: userId },
      data: { mfaSecret: null, isMfaEnabled: false, mfaBackupCodes: null },
    });
  },

  async deletePhoneTokens(userId: string, tx?: DbClient): Promise<void> {
    const client = getClient(tx);
    await client.phoneVerificationToken.deleteMany({ where: { userId } });
  },

  async createPhoneToken(
    data: {
      userId: string;
      codeHash: string;
      phone: string;
      expiresAt: Date;
    },
    tx?: DbClient,
  ): Promise<void> {
    const client = getClient(tx);
    await client.phoneVerificationToken.create({ data });
  },

  async findActivePhoneToken(
    userId: string,
    tx?: DbClient,
  ): Promise<{
    id: string;
    codeHash: string;
    phone: string;
    attempts: number;
  } | null> {
    const client = getClient(tx);
    return client.phoneVerificationToken.findFirst({
      where: {
        userId,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });
  },

  async incrementPhoneTokenAttempts(
    tokenId: string,
    tx?: DbClient,
  ): Promise<void> {
    const client = getClient(tx);
    await client.phoneVerificationToken.update({
      where: { id: tokenId },
      data: { attempts: { increment: 1 } },
    });
  },

  async markPhoneTokenUsed(tokenId: string, tx?: DbClient): Promise<void> {
    const client = getClient(tx);
    await client.phoneVerificationToken.update({
      where: { id: tokenId },
      data: { usedAt: new Date() },
    });
  },

  async markEmailVerified(id: string): Promise<void> {
    await db.user.update({
      where: { id },
      data: {
        emailVerified: new Date(),
        emailVerifyToken: null,
        emailVerifyExpires: null,
      },
    });
  },

  async updateVerificationToken(
    id: string,
    token: string,
    expiresAt: Date,
  ): Promise<void> {
    await db.user.update({
      where: { id },
      data: {
        emailVerifyToken: token,
        emailVerifyExpires: expiresAt,
      },
    });
  },

  async upsertBlock(blockerId: string, blockedId: string): Promise<void> {
    await db.blockedUser.upsert({
      where: { blockerId_blockedId: { blockerId, blockedId } },
      create: { blockerId, blockedId },
      update: {},
    });
  },

  async removeBlock(blockerId: string, blockedId: string): Promise<void> {
    await db.blockedUser.deleteMany({
      where: { blockerId, blockedId },
    });
  },
};
