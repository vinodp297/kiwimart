// src/server/services/pickup/pickup-otp.service.ts
// ─── Pickup OTP Service ─────────────────────────────────────────────────────
// Generate, send, and verify 6-digit OTP codes for pickup confirmation.
// OTP is hashed with SHA-256 before storage (same pattern as phone verification).
// SMS sending: follows project pattern (logs in dev, placeholder in production).
//
// Brute-force protection: verifyOTP() tracks incorrect attempts in Redis.
// After OTP_MAX_ATTEMPTS failures the order is locked for OTP_LOCKOUT_SECONDS
// and the stored OTP hash is nulled — the seller must generate a fresh code.

import crypto from "crypto";
import { logger } from "@/shared/logger";
import { getRedisClient } from "@/infrastructure/redis/client";

type PrismaTransactionClient = Omit<
  typeof import("@/lib/db").default,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

// ── OTP throttle constants ───────────────────────────────────────────────────

/** Redis key for per-order incorrect-attempt counter. */
const OTP_ATTEMPT_KEY = (orderId: string) => `otp:attempts:${orderId}`;

/** Redis key that signals an order is locked after too many bad attempts. */
const OTP_LOCK_KEY = (orderId: string) => `otp:locked:${orderId}`;

/** Maximum incorrect OTP attempts before the order is locked. */
const OTP_MAX_ATTEMPTS = 5;

/** How long (seconds) the lockout remains active. 15 minutes. */
const OTP_LOCKOUT_SECONDS = 900;

/**
 * How long (seconds) the attempt counter persists without a lock.
 * Set to 30 minutes — longer than the OTP validity window — so the counter
 * survives an OTP that is close to expiry.
 */
const OTP_ATTEMPT_TTL_SECONDS = 1800;

// ── generateAndSendOTP ──────────────────────────────────────────────────────

export async function generateAndSendOTP(params: {
  orderId: string;
  buyerPhone: string;
  buyerName: string;
  listingTitle: string;
  tx: PrismaTransactionClient;
}): Promise<{ success: boolean; error?: string }> {
  const {
    orderId,
    buyerPhone,
    buyerName: _buyerName,
    listingTitle: _listingTitle,
    tx,
  } = params;

  // 1. Generate cryptographically random 6-digit code
  const code = crypto.randomInt(100000, 999999).toString();

  // 2. Hash with SHA-256 (same pattern as phone verification)
  const otpCodeHash = crypto.createHash("sha256").update(code).digest("hex");

  // 3. Set expiry from config
  const { getConfigInt, CONFIG_KEYS } = await import("@/lib/platform-config");
  const otpExpiryMinutes = await getConfigInt(
    CONFIG_KEYS.PICKUP_OTP_EXPIRY_MINUTES,
  );
  const otpExpiresAt = new Date(Date.now() + otpExpiryMinutes * 60 * 1000);

  // 4. Update order with OTP data
  await tx.order.update({
    where: { id: orderId },
    data: {
      otpCodeHash,
      otpExpiresAt,
      otpInitiatedAt: new Date(),
      pickupStatus: "OTP_INITIATED",
    },
  });

  // 5. Clear any previous attempt counter and lockout so the buyer gets a
  //    fresh slate. Fail silently — the OTP was already persisted to the DB,
  //    so a Redis blip here should not block the flow.
  try {
    const redis = getRedisClient();
    await redis.del(OTP_ATTEMPT_KEY(orderId), OTP_LOCK_KEY(orderId));
  } catch {
    logger.warn("pickup.otp.redis.cleanup_failed", { orderId });
  }

  // 6. Send SMS (same pattern as phone verification — logs in dev, placeholder in prod)
  const appName = process.env.NEXT_PUBLIC_APP_NAME ?? "Buyzi";
  const smsMessage =
    `Your ${appName} pickup code is: ${code}. Valid for 30 minutes. ` +
    `Share this with the seller to complete your pickup. ` +
    `Do not share if you have not agreed to collect the item.`;

  const { sendSms, formatNzPhoneE164 } =
    await import("@/server/services/sms/sms.service");
  await sendSms({
    to: formatNzPhoneE164(buyerPhone),
    body: smsMessage,
  });

  logger.info("pickup.otp.generated", {
    orderId,
    expiresAt: otpExpiresAt.toISOString(),
  });

  return { success: true };
}

// ── verifyOTP ───────────────────────────────────────────────────────────────

export async function verifyOTP(params: {
  orderId: string;
  enteredCode: string;
  tx: PrismaTransactionClient;
}): Promise<{ valid: boolean; error?: string }> {
  const { orderId, enteredCode, tx } = params;

  // 1. Fetch order OTP data
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      otpCodeHash: true,
      otpExpiresAt: true,
      pickupStatus: true,
    },
  });

  if (!order) {
    return { valid: false, error: "Order not found." };
  }

  // 2. Validate pickup status
  if (order.pickupStatus !== "OTP_INITIATED") {
    return { valid: false, error: "No active OTP for this order." };
  }

  // 3. Check expiry
  if (!order.otpExpiresAt || order.otpExpiresAt < new Date()) {
    return {
      valid: false,
      error: "OTP has expired. Ask the seller to initiate a new one.",
    };
  }

  // 4. Require a stored hash — null means the OTP was already used or revoked
  if (!order.otpCodeHash) {
    return { valid: false, error: "No active OTP for this order." };
  }

  const inputHash = crypto
    .createHash("sha256")
    .update(enteredCode)
    .digest("hex");

  // 5. Redis-backed attempt throttling — fail-closed on Redis unavailability
  try {
    const redis = getRedisClient();

    // Reject immediately if a lockout is already active for this order
    const locked = await redis.get(OTP_LOCK_KEY(orderId));
    if (locked) {
      return {
        valid: false,
        error:
          "Too many incorrect attempts. Please ask the seller to generate a new OTP.",
      };
    }

    if (inputHash !== order.otpCodeHash) {
      // Record the failed attempt
      const attempts = await redis.incr(OTP_ATTEMPT_KEY(orderId));

      // Set a rolling TTL on the first attempt so stale counters self-expire
      if (attempts === 1) {
        await redis.expire(OTP_ATTEMPT_KEY(orderId), OTP_ATTEMPT_TTL_SECONDS);
      }

      if (attempts >= OTP_MAX_ATTEMPTS) {
        // Lock the order and invalidate the OTP to force a new generation flow
        await redis.set(OTP_LOCK_KEY(orderId), "1", {
          ex: OTP_LOCKOUT_SECONDS,
        });
        await tx.order.update({
          where: { id: orderId },
          data: { otpCodeHash: null, otpExpiresAt: null },
        });
        logger.warn("pickup.otp.locked", { orderId, attempts });
        return {
          valid: false,
          error:
            "Too many incorrect attempts. Please ask the seller to generate a new OTP.",
        };
      }

      const remaining = OTP_MAX_ATTEMPTS - attempts;
      return {
        valid: false,
        error: `Incorrect code. ${remaining} attempt(s) remaining.`,
      };
    }

    // Correct code — clean up the attempt counter (best-effort)
    try {
      await redis.del(OTP_ATTEMPT_KEY(orderId));
    } catch {
      logger.warn("pickup.otp.redis.cleanup_failed", { orderId });
    }
  } catch {
    // Redis is unavailable — fail closed. Never allow a bypass.
    logger.error("pickup.otp.redis.unavailable", { orderId });
    return {
      valid: false,
      error:
        "Verification temporarily unavailable. Please try again in a moment.",
    };
  }

  // 6. Clear OTP fields — reached only on a correct code
  await tx.order.update({
    where: { id: orderId },
    data: {
      otpCodeHash: null,
      otpExpiresAt: null,
    },
  });

  return { valid: true };
}
