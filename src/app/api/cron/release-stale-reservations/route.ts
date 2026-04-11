// src/app/api/cron/release-stale-reservations/route.ts
// ─── Vercel Cron — Release Stale Listing Reservations (Fix 10) ───────────────
// Runs every 5 minutes (schedule: "*/5 * * * *" in vercel.json) — listings
// reserved at checkout for 10 minutes need a tight reconciliation cadence so
// abandoned carts don't leave inventory parked for long.

import { NextResponse } from "next/server";
import { releaseStaleReservations } from "@/server/jobs/releaseStaleReservations";
import { verifyCronSecret } from "@/server/lib/verifyCronSecret";
import { recordCronRun } from "@/server/lib/cronLogger";
import { runCronJob } from "@/lib/cron-monitor";
import { logger } from "@/shared/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const authError = verifyCronSecret(request);
  if (authError) return authError;

  const startedAt = new Date();
  try {
    logger.info("cron.release_stale_reservations.triggered");

    const result = await runCronJob("releaseStaleReservations", async () => {
      const r = await releaseStaleReservations();
      return { processed: r.released, ...r };
    });

    await recordCronRun("release-stale-reservations", "success", startedAt);
    return NextResponse.json({
      success: true,
      released: result.released,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await recordCronRun("release-stale-reservations", "error", startedAt, msg);
    return NextResponse.json(
      { error: "Stale reservation release job failed." },
      { status: 500 },
    );
  }
}
