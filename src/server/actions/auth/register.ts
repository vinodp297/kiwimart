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

/** Returns true when a Prisma error is a unique-constraint violation on username. */
function isUsernameP2002(err: unknown): boolean {
  if (!(err instanceof Error) || !("code" in err)) return false;
  if ((err as { code: string }).code !== "P2002") return false;
  const target = (err as { meta?: { target?: unknown } }).meta?.target;
  return String(target ?? "").includes("username");
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

    const passwordHash = await hashPassword(data.password);

    const verifyToken = crypto.randomBytes(32).toString("hex");
    const verifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // Generate username — retry on P2002 collision instead of pre-checking with
    // existsByUsername (which has a TOCTOU race between the check and the insert).
    const baseUsername = generateUsername(data.firstName, data.lastName);
    let user!: Awaited<ReturnType<typeof userRepository.create>>;
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate =
        attempt === 0
          ? baseUsername
          : `${baseUsername}${crypto.randomUUID().slice(0, 8)}`;
      try {
        user = await userRepository.create({
          email: normalizedEmail,
          username: candidate,
          displayName: `${data.firstName} ${data.lastName}`,
          passwordHash,
          hasMarketingConsent: data.hasMarketingConsent,
          agreedTermsAt: new Date(),
          emailVerifyToken: verifyToken,
          emailVerifyExpires: verifyExpires,
        });
        break;
      } catch (err) {
        if (isUsernameP2002(err) && attempt < 4) continue;
        throw err;
      }
    }

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
      metadata: { email: user.email, username: user.username },
      ip,
      userAgent: ua,
    });

    return { success: true, data: { userId: user.id } };
  }); // end withActionContext
}
