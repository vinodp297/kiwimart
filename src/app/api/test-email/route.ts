// src/app/api/test-email/route.ts
// ─── Email System Diagnostic Endpoint ──────────────────────────────────────
// Returns configuration status and sends two test emails to Resend's safe test
// addresses (delivered@resend.dev / bounced@resend.dev).
//
// SECURITY: Requires SUPER_ADMIN authentication (via requireSuperAdmin).
// Reduced metadata — no API key prefix or app URL exposed.

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/shared/auth/requirePermission";
import { getEmailClient, EMAIL_FROM } from "@/infrastructure/email/client";
import { sendPasswordResetEmail } from "@/server/email";
import { logger } from "@/shared/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  // ── Auth guard — SUPER_ADMIN only ──────────────────────────────────────────
  try {
    await requireSuperAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const resend = getEmailClient();

    if (!resend) {
      logger.info("test-email: client not initialised", {
        resendKeyExists: !!process.env.RESEND_API_KEY,
        emailFromConfigured: !!process.env.EMAIL_FROM,
      });
      return NextResponse.json(
        {
          success: false,
          message: "Email client not configured.",
          emailSentTo: null,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    // ── Test 1: raw Resend client ────────────────────────────────────────────
    let rawSuccess = false;
    try {
      const { error } = await resend.emails.send({
        from: EMAIL_FROM,
        to: "delivered@resend.dev",
        subject: "KiwiMart — raw client test",
        html: `<p>Raw transport test sent at ${new Date().toISOString()}</p>`,
      });
      rawSuccess = !error;
      if (error) {
        logger.info("test-email: raw send failed", { error: String(error) });
      }
    } catch (err) {
      logger.info("test-email: raw send exception", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // ── Test 2: sendPasswordResetEmail() template ────────────────────────────
    let templateSuccess = false;
    try {
      await sendPasswordResetEmail({
        to: "delivered@resend.dev",
        displayName: "Test User",
        resetUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://kiwimart.vercel.app"}/reset-password?token=test_diagnostic_token`,
        expiresInMinutes: 60,
      });
      templateSuccess = true;
    } catch (err) {
      logger.info("test-email: template send failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return NextResponse.json(
      {
        success: rawSuccess && templateSuccess,
        message:
          rawSuccess && templateSuccess
            ? "Both test emails sent successfully."
            : rawSuccess
              ? "Raw send OK, template send failed."
              : templateSuccess
                ? "Template send OK, raw send failed."
                : "Both test emails failed.",
        emailSentTo: "delivered@resend.dev",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    logger.error("api.error", {
      path: "/api/test-email",
      error: e instanceof Error ? e.message : e,
    });
    return NextResponse.json(
      { error: "The test email couldn't be sent. Please try again." },
      { status: 500 },
    );
  }
}
