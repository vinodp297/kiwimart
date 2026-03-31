// src/app/api/cron/price-drop-alerts/route.ts
import { NextResponse } from "next/server";
import { checkPriceDrops } from "@/server/jobs/priceDropNotifications";
import { verifyCronSecret } from "@/server/lib/verifyCronSecret";
import { logger } from "@/shared/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const authError = verifyCronSecret(request);
  if (authError) return authError;

  try {
    const result = await checkPriceDrops();
    return NextResponse.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error("price_drop_alerts.cron_error", { error: String(err) });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
