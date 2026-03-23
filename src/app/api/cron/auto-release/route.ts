// src/app/api/cron/auto-release/route.ts
// ─── Vercel Cron — Auto-Release Escrow ───────────────────────────────────────
// Runs hourly (schedule: "0 * * * *" in vercel.json).
// Sends day-2 and day-3 buyer reminders, then releases overdue escrow.

import { NextRequest, NextResponse } from 'next/server';
import { processAutoReleases } from '@/server/jobs/autoReleaseEscrow';
import { sendDeliveryReminders } from '@/server/jobs/buyerReminders';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  // Verify caller is Vercel Cron or our system
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  try {
    await sendDeliveryReminders();
    const result = await processAutoReleases();

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      autoReleases: result,
    });
  } catch (error) {
    console.error('[CRON] Auto-release job failed:', error);
    return NextResponse.json({ success: false, error: 'Job failed' }, { status: 500 });
  }
}
