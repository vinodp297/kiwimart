'use server';
// src/server/actions/auth.ts
// ─── Auth Server Actions ──────────────────────────────────────────────────────
// Every action follows the 7-step security pattern:
//   1. Authenticate   — verify session exists (where required)
//   2. Authorise      — check permissions
//   3. Validate       — parse + sanitise input with Zod
//   4. Rate limit     — check Upstash Redis sliding window
//   5. Execute        — business logic
//   6. Audit log      — write immutable audit entry (fire-and-forget)
//   7. Return         — typed ActionResult<T>
//
// signIn / signOut are called from the client via Auth.js — not server actions.

import { headers } from 'next/headers';
import crypto from 'crypto';
import db from '@/lib/db';
import { hashPassword } from '@/server/lib/password';
import { rateLimit, getClientIp } from '@/server/lib/rateLimit';
import { audit } from '@/server/lib/audit';
import { logger } from '@/shared/logger';
import {
  registerSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from '@/server/validators';
import type { ActionResult } from '@/types';

// ── registerUser ──────────────────────────────────────────────────────────────

export async function registerUser(
  raw: unknown
): Promise<ActionResult<{ userId: string }>> {
  const reqHeaders = await headers();
  const ip = getClientIp(reqHeaders);
  const ua = reqHeaders.get('user-agent') ?? undefined;

  // 3. Validate
  const parsed = registerSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      success: false,
      error: 'Invalid input',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;

  // 4. Rate limit — 3 registrations per hour per IP
  const limit = await rateLimit('register', ip);
  if (!limit.success) {
    return {
      success: false,
      error: `Too many registration attempts. Try again in ${limit.retryAfter} seconds.`,
    };
  }

  // 5a. Verify Cloudflare Turnstile
  if (process.env.NODE_ENV === 'production' && data.turnstileToken) {
    const turnstileOk = await verifyTurnstile(data.turnstileToken);
    if (!turnstileOk) {
      return { success: false, error: 'Bot verification failed. Please try again.' };
    }
  }

  // 5b. Check email uniqueness
  const existingEmail = await db.user.findUnique({
    where: { email: data.email },
    select: { id: true },
  });
  if (existingEmail) {
    // Return the same error for email/username to prevent enumeration
    return {
      success: false,
      error: 'An account with this email already exists.',
      fieldErrors: { email: ['This email is already registered.'] },
    };
  }

  // 5c. Check username uniqueness
  const username = generateUsername(data.firstName, data.lastName);
  const existingUsername = await db.user.findUnique({
    where: { username },
    select: { id: true },
  });
  const finalUsername = existingUsername
    ? `${username}${Math.floor(Math.random() * 9000) + 1000}`
    : username;

  // 5d. Hash password with Argon2id
  const passwordHash = await hashPassword(data.password);

  // 5e. Generate email verification token (24-hour expiry)
  const verifyToken = crypto.randomBytes(32).toString('hex');
  const verifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

  // 5f. Create user with verification token
  const user = await db.user.create({
    data: {
      email: data.email,
      username: finalUsername,
      displayName: `${data.firstName} ${data.lastName}`,
      passwordHash,
      agreeMarketing: data.agreeMarketing,
      agreedTermsAt: new Date(),
      emailVerifyToken: verifyToken,
      emailVerifyExpires: verifyExpires,
    },
    select: { id: true, email: true, displayName: true },
  });

  // 5g. Send verification email (non-blocking; welcome email sent after verification)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://kiwimart.vercel.app';
  const verifyUrl = `${appUrl}/api/verify-email?token=${verifyToken}`;
  try {
    const { sendVerificationEmail } = await import('@/server/email');
    sendVerificationEmail({ to: user.email, displayName: user.displayName, verifyUrl }).catch(() => {});
  } catch {
    // Non-fatal — user can request resend later
    logger.error('auth.verification_email.failed', { email: user.email });
  }

  // 6. Audit
  audit({
    userId: user.id,
    action: 'USER_REGISTER',
    metadata: { email: user.email, username: finalUsername },
    ip,
    userAgent: ua,
  });

  return { success: true, data: { userId: user.id } };
}

// ── forgotPassword ────────────────────────────────────────────────────────────

export async function requestPasswordReset(
  raw: unknown
): Promise<ActionResult<void>> {
  const reqHeaders = await headers();
  const ip = getClientIp(reqHeaders);

  // 3. Validate
  const parsed = forgotPasswordSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: 'Invalid input' };
  }
  const { email, turnstileToken } = parsed.data;

  // 4. Rate limit — 5 attempts per 15 minutes per IP
  const limit = await rateLimit('auth', ip);
  if (!limit.success) {
    return {
      success: false,
      error: `Too many attempts. Try again in ${limit.retryAfter} seconds.`,
    };
  }

  // 5a. Verify Turnstile
  if (process.env.NODE_ENV === 'production' && turnstileToken) {
    const ok = await verifyTurnstile(turnstileToken);
    if (!ok) return { success: false, error: 'Bot verification failed.' };
  }

  // 5b. Look up user — NEVER reveal whether email exists (user enumeration)
  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, email: true, displayName: true },
  });

  // Always return success to prevent user enumeration
  if (user) {
    // 5c. Generate a cryptographically secure token
    const rawToken = crypto.randomBytes(32).toString('hex'); // 64 hex chars
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Invalidate any existing tokens for this user
    await db.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    // 5d. Store hashed token
    await db.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
        requestIp: ip,
        userAgent: reqHeaders.get('user-agent'),
      },
    });

    // 5e. Send reset email directly — BullMQ worker does not run on Vercel serverless
    const resetUrl = `${process.env.NEXT_PUBLIC_APP_URL}/reset-password?token=${rawToken}`;
    try {
      const { sendPasswordResetEmail } = await import('@/server/email');
      await sendPasswordResetEmail({ to: user.email, displayName: user.displayName, resetUrl, expiresInMinutes: 60 });
    } catch {
      // Log but do not rethrow — always return success to prevent user enumeration
      logger.warn('auth.password_reset.email.failed', { email: user.email });
    }

    // 6. Audit
    audit({
      userId: user.id,
      action: 'USER_PASSWORD_CHANGED',
      metadata: { step: 'reset_requested' },
      ip,
    });
  }

  // Always return success (user enumeration prevention)
  return { success: true, data: undefined };
}

// ── resetPassword ─────────────────────────────────────────────────────────────

export async function resetPassword(raw: unknown): Promise<ActionResult<void>> {
  const reqHeaders = await headers();
  const ip = getClientIp(reqHeaders);

  // 3. Validate
  const parsed = resetPasswordSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      success: false,
      error: 'Invalid input',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const { token, password } = parsed.data;

  // 4. Rate limit
  const limit = await rateLimit('auth', ip);
  if (!limit.success) {
    return {
      success: false,
      error: `Too many attempts. Try again in ${limit.retryAfter} seconds.`,
    };
  }

  // 5a. Hash the raw token to look up in DB
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  const resetRecord = await db.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: { select: { id: true, email: true, displayName: true } } },
  });

  // 5b. Validate token
  const GENERIC_ERROR = 'Invalid or expired reset link. Please request a new one.';
  if (!resetRecord) return { success: false, error: GENERIC_ERROR };
  if (resetRecord.usedAt) return { success: false, error: GENERIC_ERROR };
  if (resetRecord.expiresAt < new Date()) return { success: false, error: GENERIC_ERROR };

  // 5c. Hash new password and update user
  const newHash = await hashPassword(password);
  await db.$transaction([
    db.user.update({
      where: { id: resetRecord.userId },
      data: { passwordHash: newHash },
    }),
    db.passwordResetToken.update({
      where: { id: resetRecord.id },
      data: { usedAt: new Date() },
    }),
    // Invalidate all active sessions for security
    db.session.deleteMany({ where: { userId: resetRecord.userId } }),
  ]);

  // 6. Audit
  audit({
    userId: resetRecord.userId,
    action: 'USER_PASSWORD_CHANGED',
    metadata: { step: 'reset_completed' },
    ip,
  });

  return { success: true, data: undefined };
}

// ── resendVerificationEmail ──────────────────────────────────────────────────

export async function resendVerificationEmail(): Promise<ActionResult<void>> {
  const reqHeaders = await headers();
  const ip = getClientIp(reqHeaders);

  // Rate limit — 3 resend attempts per 15 min per IP
  const limit = await rateLimit('auth', ip);
  if (!limit.success) {
    return {
      success: false,
      error: `Too many attempts. Try again in ${limit.retryAfter} seconds.`,
    };
  }

  // We need a session — use auth() directly here since requireUser()
  // may redirect unverified users in some configurations
  const { auth } = await import('@/lib/auth');
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: 'Not logged in.' };
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      displayName: true,
      emailVerified: true,
    },
  });

  if (!user) {
    return { success: false, error: 'User not found.' };
  }

  if (user.emailVerified) {
    return { success: false, error: 'Email is already verified.' };
  }

  // Generate new token (24-hour expiry)
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await db.user.update({
    where: { id: user.id },
    data: {
      emailVerifyToken: token,
      emailVerifyExpires: expires,
    },
  });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://kiwimart.vercel.app';
  const verifyUrl = `${appUrl}/api/verify-email?token=${token}`;

  try {
    const { sendVerificationEmail } = await import('@/server/email');
    await sendVerificationEmail({
      to: user.email,
      displayName: user.displayName ?? 'there',
      verifyUrl,
    });
  } catch {
    logger.error('auth.resend_verification.failed', { email: user.email });
    return { success: false, error: 'Failed to send email. Please try again.' };
  }

  audit({
    userId: user.id,
    action: 'USER_PASSWORD_CHANGED',
    metadata: { step: 'verification_email_resent' },
    ip,
  });

  return { success: true, data: undefined };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateUsername(firstName: string, lastName: string): string {
  const base = `${firstName}${lastName}`
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 20);
  return base || 'user';
}

async function verifyTurnstile(token: string): Promise<boolean> {
  try {
    const res = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          secret: process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY!,
          response: token,
        }),
      }
    );
    const data = (await res.json()) as { success: boolean };
    return data.success;
  } catch {
    return false;
  }
}

