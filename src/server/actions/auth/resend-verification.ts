"use server";
// src/server/actions/auth/resend-verification.ts
// ─── Resend Verification Email Server Action ──────────────────────────────────
// Allows users to request a new verification email if the original was lost.
// Returns generic success message to prevent email enumeration.

import { headers } from "next/headers";
import crypto from "crypto";
import { z } from "zod";
import { userRepository } from "@/modules/users/user.repository";
import { rateLimit, getClientIp } from "@/server/lib/rateLimit";
import { enqueueEmail } from "@/lib/email-queue";
import { logger } from "@/shared/logger";
import { AppError } from "@/shared/errors";
import type { ActionResult } from "@/types";
import { withActionContext } from "@/lib/action-context";
import { env } from "@/env";

const resendVerificationSchema = z.object({
  email: z
    .string()
    .min(1, "Email is required")
    .email("Enter a valid email address")
    .max(254, "Email is too long")
    .toLowerCase()
    .trim(),
});

export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;

export async function resendVerificationEmail(
  raw: unknown,
): Promise<ActionResult<{ message: string }>> {
  return withActionContext(async () => {
    try {
      const reqHeaders = await headers();
      const ip = getClientIp(reqHeaders);

      const parsed = resendVerificationSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          success: false,
          error: "Please enter a valid email address.",
          fieldErrors: parsed.error.flatten().fieldErrors,
        };
      }

      const { email } = parsed.data;

      // Rate limit: 3 per hour per IP
      const limit = await rateLimit("resendVerification", ip);
      if (!limit.success) {
        // Always return generic success (enumeration guard)
        return {
          success: true,
          data: {
            message:
              "If that email is registered and unverified, a new verification link has been sent.",
          },
        };
      }

      // Find user by email — if not found, return generic success
      // (prevents email enumeration)
      const user = await userRepository.findByEmail(email);
      if (!user) {
        return {
          success: true,
          data: {
            message:
              "If that email is registered and unverified, a new verification link has been sent.",
          },
        };
      }

      // Check if already verified — if so, return generic success
      const verification = await userRepository.findForEmailVerification(
        user.id,
      );
      if (verification?.emailVerified) {
        return {
          success: true,
          data: {
            message:
              "If that email is registered and unverified, a new verification link has been sent.",
          },
        };
      }

      // Generate new verification token (24-hour expiry)
      const newToken = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      // Update user with new token
      await userRepository.updateVerificationToken(
        user.id,
        newToken,
        expiresAt,
      );

      // Queue verification email (fire-and-forget)
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

      // Return generic success
      return {
        success: true,
        data: {
          message:
            "If that email is registered and unverified, a new verification link has been sent.",
        },
      };
    } catch (err) {
      // Error envelope — never throw
      if (err instanceof AppError) {
        logger.warn("auth.resend_verification.app_error", {
          code: err.code,
          message: err.message,
        });
        return {
          success: false,
          error: err.message,
          code: err.code,
        };
      }
      logger.error("auth.resend_verification.unknown_error", {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      return {
        success: false,
        error:
          "We couldn't process your request just now. Please try again in a moment.",
        code: "RESEND_VERIFICATION_FAILED",
      };
    }
  }); // end withActionContext
}
