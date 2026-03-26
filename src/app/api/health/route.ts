// src/app/api/health/route.ts
// ─── Enhanced Health Check ────────────────────────────────────────────────────
// Checks all critical services: database, Redis, Stripe.
// Returns 200 when all healthy, 503 when any service is degraded.

import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getRedisClient } from '@/infrastructure/redis/client';
import { stripe } from '@/infrastructure/stripe/client';
import { logger } from '@/shared/logger';

export const dynamic = 'force-dynamic';

interface ServiceCheck {
  name: string;
  status: 'ok' | 'error';
  latencyMs?: number;
  error?: string;
}

// Caps each service check at timeoutMs — prevents a slow dependency from
// hanging the entire health endpoint (uptime monitors have short timeouts).
async function checkService(
  name: string,
  fn: () => Promise<void>,
  timeoutMs = 2000
): Promise<ServiceCheck> {
  const start = Date.now();
  try {
    await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), timeoutMs)
      ),
    ]);
    return {
      name,
      status: 'ok',
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      name,
      status: 'error',
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function GET() {
  const start = Date.now();

  const checks = await Promise.allSettled([
    checkService('database', async () => {
      await db.$queryRaw`SELECT 1`;
    }),
    checkService('redis', async () => {
      await getRedisClient().ping();
    }),
    checkService('stripe', async () => {
      // Lightweight check — just verify the API key is accepted
      await stripe.balance.retrieve();
    }),
  ]);

  const services: ServiceCheck[] = checks.map((result) =>
    result.status === 'fulfilled'
      ? result.value
      : {
          name: 'unknown',
          status: 'error' as const,
          error: 'Check failed',
        }
  );

  const allHealthy = services.every((s) => s.status === 'ok');
  const totalLatencyMs = Date.now() - start;

  if (!allHealthy) {
    logger.error('health.check.degraded', {
      services: services.filter((s) => s.status === 'error'),
    });
  }

  return NextResponse.json(
    {
      status: allHealthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      environment: process.env.NODE_ENV,
      totalLatencyMs,
      services,
    },
    { status: allHealthy ? 200 : 503 }
  );
}
