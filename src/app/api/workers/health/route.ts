// src/app/api/workers/health/route.ts
// ─── Worker Health Check ──────────────────────────────────────────────────────
// Verifies the Redis queue connection is reachable.
// Returns 200 when healthy, 503 when the queue is unreachable.
//
// Used by Better Uptime and Railway health checks.

import { NextResponse } from 'next/server'
import { getQueueConnection } from '@/infrastructure/queue/client'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await getQueueConnection().ping()

    return NextResponse.json({
      status: 'ok',
      queues: ['payout', 'email', 'image'],
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    return NextResponse.json(
      {
        status: 'error',
        error: err instanceof Error ? err.message : 'Queue connection failed',
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    )
  }
}
