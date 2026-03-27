// src/server/lib/verifyCronSecret.ts
// ─── Shared Cron Auth Guard ─────────────────────────────────────────────────
// Fail-closed: returns an error response if CRON_SECRET is unset or mismatched.
// Usage:
//   const authError = verifyCronSecret(request)
//   if (authError) return authError

import { NextResponse } from 'next/server';
import { logger } from '@/shared/logger';

/**
 * Verifies the Authorization header matches the CRON_SECRET env var.
 * Returns a NextResponse error if unauthorized, or null if authorized.
 */
export function verifyCronSecret(request: Request): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');

  if (!cronSecret) {
    logger.error('cron.auth: CRON_SECRET env var not set — blocking request');
    return NextResponse.json(
      { error: 'Service unavailable' },
      { status: 503 }
    );
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    logger.warn('cron.auth: unauthorized request', {
      path: request.url,
      ip: request.headers.get('x-real-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown',
    });
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  return null; // Authorized — proceed
}
