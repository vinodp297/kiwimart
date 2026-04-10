// src/app/api/cron/delivery-reminders/route.ts
// ─── Vercel Cron — Delivery Reminders & Auto-Complete ──────────────────────
// Runs daily at 4:00 AM UTC (schedule: "0 4 * * *" in vercel.json).
// Sends reminders for overdue deliveries and auto-completes unresponsive orders.

import { NextRequest, NextResponse } from "next/server";
import { processDeliveryReminders } from "@/server/jobs/deliveryReminders";
import { verifyCronSecret } from "@/server/lib/verifyCronSecret";
import { recordCronRun } from "@/server/lib/cronLogger";
import { runCronJob } from "@/lib/cron-monitor";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authError = verifyCronSecret(request);
  if (authError) return authError;

  const startedAt = new Date();
  try {
    const result = await runCronJob("deliveryReminders", async () => {
      const r = await processDeliveryReminders();
      return {
        processed: r.remindersSent + r.autoCompleted,
        ...r,
      };
    });

    await recordCronRun("delivery-reminders", "success", startedAt);
    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      deliveryReminders: {
        remindersSent: result.remindersSent,
        autoCompleted: result.autoCompleted,
        errors: result.errors,
        skipped: result.skipped,
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await recordCronRun("delivery-reminders", "error", startedAt, msg);
    return NextResponse.json(
      { success: false, error: "Job failed" },
      { status: 500 },
    );
  }
}
