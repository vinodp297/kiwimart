// src/app/api/cron/delivery-reminders/route.ts
// ─── Vercel Cron — Delivery Reminders & Auto-Complete ──────────────────────
// Runs daily at 4:00 AM UTC (schedule: "0 4 * * *" in vercel.json).
// Sends reminders for overdue deliveries and auto-completes unresponsive orders.

import { NextRequest, NextResponse } from "next/server";
import { processDeliveryReminders } from "@/server/jobs/deliveryReminders";
import { verifyCronSecret } from "@/server/lib/verifyCronSecret";
import { logger } from "@/shared/logger";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authError = verifyCronSecret(request);
  if (authError) return authError;

  try {
    const result = await processDeliveryReminders();

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      deliveryReminders: result,
    });
  } catch (error) {
    logger.error("cron.delivery_reminders.failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { success: false, error: "Job failed" },
      { status: 500 },
    );
  }
}
