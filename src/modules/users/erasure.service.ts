// src/modules/users/erasure.service.ts
// Core logic for anonymising a user account and creating an immutable
// ErasureLog record. Called by:
//   • Self-service deletion (POST /api/v1/account/delete)
//   • Admin-initiated erasure (POST /api/admin/users/:userId/erase)
//   • Legacy deleteAccount() server action

import db from "@/lib/db";
import { userRepository } from "./user.repository";
import { logger } from "@/shared/logger";
import { invalidateAllSessions } from "@/server/lib/sessionStore";
import { revokeAllMobileTokens } from "@/lib/mobile-auth";
import { enqueueEmail } from "@/lib/email-queue";
import { AppError } from "@/shared/errors";

export interface ErasureOptions {
  userId: string;
  operatorId: string; // "self-service" or admin userId
  scope?: "full" | "partial";
}

export interface ErasureResult {
  erasureLogId: string;
  anonymisedEmail: string;
}

/**
 * Performs a full account erasure within a single transaction.
 *
 * Anonymisation order:
 *   1. Anonymise User record (PII → null or placeholder)
 *   2. Delete Messages sent by user
 *   3. Delete Watchlist items
 *   4. Anonymise Reviews (keep text, replace author display)
 *   5. Cancel PENDING orders (no refund — payment not yet captured)
 *   6. Withdraw pending offers
 *   7. Revoke all browser sessions (in transaction)
 *   8. Create ErasureLog record (immutable)
 *
 * After transaction:
 *   9. Invalidate JWT session version (Redis)
 *  10. Revoke all mobile tokens (Redis)
 */
export async function performAccountErasure(
  options: ErasureOptions,
): Promise<ErasureResult> {
  const { userId, operatorId, scope = "full" } = options;

  // Capture original email + display name BEFORE anonymisation so we can
  // send the erasure confirmation to the correct address.
  const originalUser = await db.user.findUnique({
    where: { id: userId },
    select: { email: true, displayName: true },
  });

  // Pre-flight: reject if user has orders in active escrow
  const activeOrderCount = await db.order.count({
    where: {
      OR: [{ buyerId: userId }, { sellerId: userId }],
      status: {
        in: ["AWAITING_PAYMENT", "PAYMENT_HELD", "DISPATCHED", "DISPUTED"],
      },
    },
  });

  if (activeOrderCount > 0) {
    throw new AppError(
      "ERASURE_BLOCKED",
      `Cannot erase account with ${activeOrderCount} active order(s). Resolve all active orders first.`,
      409,
    );
  }

  const anonymisedEmail = `deleted_${userId}@buyzi.deleted`;

  const erasureLogId = await db.$transaction(async (tx) => {
    await userRepository.update(
      userId,
      {
        email: anonymisedEmail,
        displayName: "Deleted User",
        username: `deleted_${userId.slice(0, 8)}`,
        bio: null,
        avatarKey: null,
        coverImageKey: null,
        phone: null,
        isPhoneVerified: false,
        dateOfBirth: null,
        region: null,
        suburb: null,
        nzbn: null,
        gstNumber: null,
        mfaSecret: null,
        isMfaEnabled: false,
        mfaBackupCodes: null,
        deletedAt: new Date(),
        emailVerified: null,
        passwordHash: null,
      },
      tx,
    );

    await tx.message.deleteMany({ where: { senderId: userId } });

    await tx.watchlistItem.deleteMany({ where: { userId } });

    // 4. Anonymise Reviews — keep text for marketplace integrity
    await tx.review.updateMany({
      where: { authorId: userId },
      data: { authorId: userId }, // Keep FK but display as "Anonymous" via UI logic
    });

    // 5. Cancel PENDING orders (no payment captured yet)
    await tx.order.updateMany({
      where: {
        OR: [{ buyerId: userId }, { sellerId: userId }],
        status: "AWAITING_PAYMENT",
      },
      data: {
        status: "CANCELLED",
        cancelledBy: "SYSTEM",
        cancelReason: "Account deleted by user",
        cancelledAt: new Date(),
      },
    });

    await tx.offer.updateMany({
      where: { buyerId: userId, status: "PENDING" },
      data: { status: "WITHDRAWN" },
    });

    await userRepository.deleteAllSessions(userId, tx);

    // 8. Create immutable ErasureLog
    const log = await tx.erasureLog.create({
      data: {
        userId,
        scope,
        operatorId,
        completedAt: new Date(),
      },
    });

    return log.id;
  });

  // 9. Invalidate JWT session version (Redis) — forces all JWTs to be rejected
  try {
    await invalidateAllSessions(userId);
  } catch {
    logger.warn("erasure.session_invalidation.failed", { userId });
  }

  try {
    await revokeAllMobileTokens(userId);
  } catch {
    logger.warn("erasure.mobile_token_revocation.failed", { userId });
  }

  logger.info("account.erased", {
    userId,
    operatorId,
    scope,
    erasureLogId,
  });

  // Send erasure confirmation to the original email address — queued asynchronously.
  // Must be sent AFTER the erasure succeeds so the confirmation is only sent
  // when the erasure was actually performed.
  if (originalUser) {
    await enqueueEmail({
      template: "erasureConfirmation",
      to: originalUser.email,
      displayName: originalUser.displayName ?? "User",
    }).catch((err) => {
      logger.warn("erasure.email_queue.failed", {
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  return { erasureLogId, anonymisedEmail };
}
