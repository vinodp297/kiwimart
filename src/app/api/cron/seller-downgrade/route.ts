// src/app/api/cron/seller-downgrade/route.ts
// ─── Vercel Cron — Seller Tier Downgrade Check ──────────────────────────────
// Runs daily at 6:00 AM UTC (schedule: "0 6 * * *" in vercel.json).
// Checks sellers whose dispute rate or open dispute count exceeds thresholds
// and downgrades their performance tier by one level.

import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/server/lib/verifyCronSecret";
import { runSellerDowngradeCheck } from "@/server/jobs/sellerDowngradeCheck";
import { recordCronRun } from "@/server/lib/cronLogger";
import { logger } from "@/shared/logger";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authError = verifyCronSecret(request);
  if (authError) return authError;

  const startedAt = new Date();
  try {
    const result = await runSellerDowngradeCheck();
    await recordCronRun("seller-downgrade", "success", startedAt);
    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      data: result,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("cron.seller-downgrade.failed", { error: msg });
    await recordCronRun("seller-downgrade", "error", startedAt, msg);
    return NextResponse.json(
      { success: false, error: "Seller downgrade check failed" },
      { status: 500 },
    );
  }
}
