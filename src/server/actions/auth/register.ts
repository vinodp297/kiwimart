"use server";
// src/server/actions/auth/register.ts
// Registration server action with Turnstile, breach-check, and email verification.

import { headers } from "next/headers";
import crypto from "crypto";
import { userRepository } from "@/modules/users/user.repository";
import { hashPassword, isPasswordBreached } from "@/server/lib/password";
import { rateLimit, getClientIp } from "@/server/lib/rateLimit";
import { verifyTurnstile } from "@/server/lib/turnstile";
import { audit } from "@/server/lib/audit";
import { logger } from "@/shared/logger";
import { enqueueEmail } from "@/lib/email-queue";
import { registerSchema } from "@/server/validators";
import type { ActionResult } from "@/types";
import { withActionContext } from "@/lib/action-context";

function generateUsername(firstName: string, lastName: string): string {
  const base = `${firstName}${lastName}`
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 20);
  return base || "user";
}

export async function registerUser(
  raw: unknown,
): Promise<ActionResult<{ userId: string }>> {
  return withActionContext(async () => {
    const reqHeaders = await headers();
    const ip = getClientIp(reqHeaders);
    const ua = reqHeaders.get("user-agent") ?? undefined;

    const parsed = registerSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        success: false,
        error: "Please fix the errors below and try again.",
        fieldErrors: parsed.error.flatten().fieldErrors,
      };
    }
    const data = parsed.data;

    // Normalise email — lowercase + trim to prevent case-mismatch with login
    const normalizedEmail = data.email.toLowerCase().trim();

    const limit = await rateLimit("register", ip);
    if (!limit.success) {
      return {
        success: false,
        error: `Too many registration attempts. Try again in ${limit.retryAfter} seconds.`,
      };
    }

    // Verify Cloudflare Turnstile — FAIL CLOSED in production.
    // Empty/missing tokens are rejected. Client gets key via /api/auth/turnstile-config.
    if (process.env.NODE_ENV === "production") {
      if (!data.turnstileToken) {
        return {
          success: false,
          error:
            "Bot verification required. Please complete the security check.",
        };
      }
      const turnstileOk = await verifyTurnstile(data.turnstileToken, ip);
      if (!turnstileOk) {
        return {
          success: false,
          error: "Bot verification failed. Please try again.",
        };
      }
    }

    // Check password against breach database (k-anonymity — never sends full password).
    // FAIL OPEN: isPasswordBreached returns false on network errors internally, but this
    // outer try-catch guards against any unexpected throw.
    let isCompromised = false;
    try {
      isCompromised = await isPasswordBreached(data.password);
    } catch (err) {
      logger.warn("auth.register.breach_check_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    if (isCompromised) {
      return {
        success: false,
        error:
          "This password has appeared in a data breach. Please choose a different password.",
        fieldErrors: {
          password: [
            "This password is known to be compromised. Please choose a different one.",
          ],
        },
      };
    }

    const emailTaken = await userRepository.existsByEmail(normalizedEmail);
    if (emailTaken) {
      return {
        success: false,
        error: "An account with this email already exists.",
        fieldErrors: { email: ["This email is already registered."] },
      };
    }

    const username = generateUsername(data.firstName, data.lastName);
    const usernameTaken = await userRepository.existsByUsername(username);
    const finalUsername = usernameTaken
      ? `${username}${Math.floor(Math.random() * 9000) + 1000}`
      : username;

    const passwordHash = await hashPassword(data.password);

    const verifyToken = crypto.randomBytes(32).toString("hex");
    const verifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const user = await userRepository.create({
      email: normalizedEmail,
      username: finalUsername,
      displayName: `${data.firstName} ${data.lastName}`,
      passwordHash,
      hasMarketingConsent: data.hasMarketingConsent,
      agreedTermsAt: new Date(),
      emailVerifyToken: verifyToken,
      emailVerifyExpires: verifyExpires,
    });

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
    const verifyUrl = `${appUrl}/api/verify-email?token=${verifyToken}`;
    await enqueueEmail({
      template: "verification",
      to: user.email,
      displayName: user.displayName,
      verifyUrl,
    }).catch((err) => {
      logger.warn("auth.register.email_queue.failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    audit({
      userId: user.id,
      action: "USER_REGISTER",
      metadata: { email: user.email, username: finalUsername },
      ip,
      userAgent: ua,
    });

    return { success: true, data: { userId: user.id } };
  }); // end withActionContext
}
