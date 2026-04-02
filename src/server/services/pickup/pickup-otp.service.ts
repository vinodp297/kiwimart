// src/server/services/pickup/pickup-otp.service.ts
// ─── Pickup OTP Service ─────────────────────────────────────────────────────
// Generate, send, and verify 6-digit OTP codes for pickup confirmation.
// OTP is hashed with SHA-256 before storage (same pattern as phone verification).
// SMS sending: follows project pattern (logs in dev, placeholder in production).

import crypto from "crypto";
import { logger } from "@/shared/logger";

type PrismaTransactionClient = Omit<
  typeof import("@/lib/db").default,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

// ── generateAndSendOTP ──────────────────────────────────────────────────────

export async function generateAndSendOTP(params: {
  orderId: string;
  buyerPhone: string;
  buyerName: string;
  listingTitle: string;
  tx: PrismaTransactionClient;
}): Promise<{ success: boolean; error?: string }> {
  const { orderId, buyerPhone, buyerName, listingTitle, tx } = params;

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

  // 5. Send SMS (same pattern as phone verification — logs in dev, placeholder in prod)
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

  // 4. Compare entered code against hash
  if (!order.otpCodeHash) {
    return { valid: false, error: "No active OTP for this order." };
  }

  const inputHash = crypto
    .createHash("sha256")
    .update(enteredCode)
    .digest("hex");

  if (inputHash !== order.otpCodeHash) {
    return {
      valid: false,
      error: "Incorrect code. Please check and try again.",
    };
  }

  // 5. Clear OTP fields
  await tx.order.update({
    where: { id: orderId },
    data: {
      otpCodeHash: null,
      otpExpiresAt: null,
    },
  });

  return { valid: true };
}
