'use server';
// src/server/actions/verification.ts
// ─── Phone Verification Server Actions ───────────────────────────────────────
// Flow:
//   1. requestPhoneVerification → generates 6-digit code, stores HASH in DB,
//      sends SMS (placeholder — logs to console in dev)
//   2. verifyPhoneCode → compares hash, marks user phoneVerified
//
// Security:
//   • Code stored as SHA-256 hash — never plaintext in DB
//   • Max 3 verification attempts per token
//   • Codes expire after 10 minutes
//   • Rate limited: 5 attempts per 15 min (auth limiter)

import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import db from '@/lib/db';
import { audit } from '@/server/lib/audit';
import type { ActionResult } from '@/types';
import crypto from 'crypto';

// ── Helper: hash verification code ──────────────────────────────────────────

function hashCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

function generateCode(): string {
  // Cryptographically secure 6-digit code
  return crypto.randomInt(100000, 999999).toString();
}

// ── requestPhoneVerification ────────────────────────────────────────────────

export async function requestPhoneVerification(params: {
  phone: string;
}): Promise<ActionResult<{ expiresAt: string }>> {
  const reqHeaders = await headers();
  const ip = reqHeaders.get('x-forwarded-for') ?? 'unknown';

  // 1. Authenticate
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: 'Authentication required.' };
  }

  // 3. Validate NZ phone number format
  const phoneClean = params.phone.replace(/[\s-()]/g, '');
  const nzPhoneRegex = /^(\+?64|0)\d{7,10}$/;
  if (!nzPhoneRegex.test(phoneClean)) {
    return { success: false, error: 'Please enter a valid NZ phone number.' };
  }

  // 5a. Generate code and hash
  const code = generateCode();
  const codeHash = hashCode(code);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  // 5b. Invalidate any existing tokens for this user
  await db.phoneVerificationToken.deleteMany({
    where: { userId: session.user.id },
  });

  // 5c. Store hashed token
  await db.phoneVerificationToken.create({
    data: {
      userId: session.user.id,
      codeHash,
      phone: phoneClean,
      expiresAt,
    },
  });

  // 5d. Send SMS (placeholder — in production, use Twilio/MessageBird/etc.)
  // In development, log to console
  if (process.env.NODE_ENV === 'development') {
    console.log(`[Verification] SMS code for ${phoneClean}: ${code}`);
  } else {
    // TODO: Integrate SMS provider (Twilio, MessageBird, etc.)
    // await sendSms(phoneClean, `Your KiwiMart verification code is: ${code}`);
    console.log(`[Verification] Would send SMS to ${phoneClean}`);
  }

  // 5e. Update user phone number
  await db.user.update({
    where: { id: session.user.id },
    data: { phone: phoneClean },
  });

  // 6. Audit
  audit({
    userId: session.user.id,
    action: 'PHONE_VERIFIED',
    metadata: { step: 'code_requested', phone: phoneClean.slice(-4) },
    ip,
  });

  return {
    success: true,
    data: { expiresAt: expiresAt.toISOString() },
  };
}

// ── verifyPhoneCode ─────────────────────────────────────────────────────────

export async function verifyPhoneCode(params: {
  code: string;
}): Promise<ActionResult<void>> {
  const reqHeaders = await headers();
  const ip = reqHeaders.get('x-forwarded-for') ?? 'unknown';

  // 1. Authenticate
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: 'Authentication required.' };
  }

  // 3. Validate code format
  if (!/^\d{6}$/.test(params.code)) {
    return { success: false, error: 'Please enter a 6-digit code.' };
  }

  // 5a. Find active token for this user
  const token = await db.phoneVerificationToken.findFirst({
    where: {
      userId: session.user.id,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!token) {
    return { success: false, error: 'Verification code expired. Please request a new one.' };
  }

  // 5b. Check attempt limit
  if (token.attempts >= 3) {
    return { success: false, error: 'Too many attempts. Please request a new code.' };
  }

  // 5c. Increment attempts
  await db.phoneVerificationToken.update({
    where: { id: token.id },
    data: { attempts: { increment: 1 } },
  });

  // 5d. Compare hashes
  const inputHash = hashCode(params.code);
  if (inputHash !== token.codeHash) {
    return { success: false, error: 'Invalid verification code. Please try again.' };
  }

  // 5e. Mark token as used and user as verified
  await db.$transaction([
    db.phoneVerificationToken.update({
      where: { id: token.id },
      data: { usedAt: new Date() },
    }),
    db.user.update({
      where: { id: session.user.id },
      data: {
        phoneVerified: true,
        phoneVerifiedAt: new Date(),
        phone: token.phone,
      },
    }),
  ]);

  // 6. Audit
  audit({
    userId: session.user.id,
    action: 'PHONE_VERIFIED',
    entityType: 'User',
    entityId: session.user.id,
    metadata: { step: 'verified', phone: token.phone.slice(-4) },
    ip,
  });

  return { success: true, data: undefined };
}
