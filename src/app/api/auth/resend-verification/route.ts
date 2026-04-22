// src/app/api/auth/resend-verification/route.ts
// ─── Resend Verification Email ───────────────────────────────────────────────
// POST /api/auth/resend-verification
// Allows a user to request a new verification email if the original was lost.
// Always returns success to prevent email enumeration.

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { userRepository } from "@/modules/users/user.repository";
import { rateLimit, getClientIp } from "@/server/lib/rateLimit";
import { enqueueEmail } from "@/lib/email-queue";
import { logger } from "@/shared/logger";
import { env } from "@/env";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(await request.headers);

    // Rate limit: 3 per hour per IP
    const limit = await rateLimit("resendVerification", ip);
    if (!limit.success) {
      return NextResponse.json(
        {
          success: true,
          message:
            "If that email is registered and unverified, a new verification link has been sent.",
        },
        { status: 200 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid request body" },
        { status: 400 },
      );
    }

    const email =
      typeof body === "object" && body !== null && "email" in body
        ? (body as { email?: unknown }).email
        : null;

    if (typeof email !== "string" || !email.trim()) {
      return NextResponse.json(
        { success: false, error: "Email is required" },
        { status: 400 },
      );
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Find user by email — if not found or already verified, return success anyway
    // (prevents email enumeration — never reveal whether email exists)
    const user = await userRepository.findByEmail(normalizedEmail);
    if (!user) {
      // Email not found in system — return generic success
      return NextResponse.json(
        {
          success: true,
          message:
            "If that email is registered and unverified, a new verification link has been sent.",
        },
        { status: 200 },
      );
    }

    // Check if already verified
    const verification = await userRepository.findForEmailVerification(user.id);
    if (verification?.emailVerified) {
      // Already verified — return generic success (don't reveal)
      return NextResponse.json(
        {
          success: true,
          message:
            "If that email is registered and unverified, a new verification link has been sent.",
        },
        { status: 200 },
      );
    }

    // Generate new verification token and expiry (24 hours)
    const newToken = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // Update user with new token
    await userRepository.updateVerificationToken(user.id, newToken, expiresAt);

    // Enqueue verification email (fire-and-forget)
    const appUrl = env.NEXT_PUBLIC_APP_URL ?? "";
    const verifyUrl = `${appUrl}/api/verify-email?token=${newToken}`;

    await enqueueEmail({
      template: "verification",
      to: user.email,
      displayName: user.displayName,
      verifyUrl,
    }).catch((err) => {
      logger.warn("auth.resend_verification.email_queue.failed", {
        userId: user.id,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    logger.info("auth.resend_verification.sent", {
      userId: user.id,
      email: user.email,
    });

    // Always return success (enumeration guard)
    return NextResponse.json(
      {
        success: true,
        message:
          "If that email is registered and unverified, a new verification link has been sent.",
      },
      { status: 200 },
    );
  } catch (e) {
    logger.error("api.error", {
      path: "/api/auth/resend-verification",
      error: e instanceof Error ? e.message : String(e),
    });
    // Return success even on error (don't leak internal state)
    return NextResponse.json(
      {
        success: true,
        message:
          "If that email is registered and unverified, a new verification link has been sent.",
      },
      { status: 200 },
    );
  }
}
