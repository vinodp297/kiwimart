// src/app/api/cron/daily-digest/route.ts
import { NextResponse } from 'next/server';
import { sendDailyDigest } from '@/server/jobs/dailyDigest';
import { logger } from '@/shared/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');

  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await sendDailyDigest();
    return NextResponse.json({ success: true, timestamp: new Date().toISOString() });
  } catch (err) {
    logger.error('daily_digest.cron_error', { error: String(err) });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
