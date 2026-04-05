// src/app/api/cron/price-drop-alerts/route.ts
import { NextResponse } from "next/server";
import { checkPriceDrops } from "@/server/jobs/priceDropNotifications";
import { verifyCronSecret } from "@/server/lib/verifyCronSecret";
import { recordCronRun } from "@/server/lib/cronLogger";
import { logger } from "@/shared/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const authError = verifyCronSecret(request);
  if (authError) return authError;

  const startedAt = new Date();
  try {
    const result = await checkPriceDrops();
    await recordCronRun("price-drop-alerts", "success", startedAt);
    return NextResponse.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("price_drop_alerts.cron_error", { error: msg });
    await recordCronRun("price-drop-alerts", "error", startedAt, msg);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
