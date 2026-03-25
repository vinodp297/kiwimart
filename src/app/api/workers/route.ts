// src/app/api/workers/route.ts  (Sprint 4)
// ─── Worker Startup Endpoint ─────────────────────────────────────────────────
// Starts all BullMQ workers on POST request.
// Protected with WORKER_SECRET env var — call from Railway/deployment init.
//
// Usage: POST /api/workers with Authorization: Bearer {WORKER_SECRET}

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { logger } from '@/shared/logger';

export const runtime = 'nodejs';

let workersStarted = false;

export async function POST(request: NextRequest) {
  // 1. Verify worker secret
  const authHeader = request.headers.get('authorization');
  const expectedSecret = process.env.WORKER_SECRET;

  if (!expectedSecret) {
    return NextResponse.json(
      { error: 'WORKER_SECRET not configured' },
      { status: 500 }
    );
  }

  const token = authHeader?.replace('Bearer ', '');
  if (token !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 403 });
  }

  // 2. Prevent double-starting
  if (workersStarted) {
    return NextResponse.json({ status: 'already_running' });
  }

  // 3. Start all workers
  try {
    const { startEmailWorker } = await import('@/server/workers/emailWorker');
    const { startImageWorker } = await import('@/server/workers/imageWorker');
    const { startPayoutWorker } = await import('@/server/workers/payoutWorker');

    startEmailWorker();
    startImageWorker();
    startPayoutWorker();

    workersStarted = true;

    logger.info('workers.started', { workers: ['email', 'image', 'payout'] });
    return NextResponse.json({
      status: 'started',
      workers: ['email', 'image', 'payout'],
    });
  } catch (err) {
    logger.error('workers.start_failed', { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      { error: 'Failed to start workers', details: String(err) },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    status: workersStarted ? 'running' : 'stopped',
  });
}
