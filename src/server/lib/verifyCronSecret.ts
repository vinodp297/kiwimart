// src/server/lib/verifyCronSecret.ts
// ─── Shared Cron Auth Guard ─────────────────────────────────────────────────
// Fail-closed: returns an error response if CRON_SECRET is unset or mismatched.
// Usage:
//   const authError = verifyCronSecret(request)
//   if (authError) return authError

import { timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import { logger } from '@/shared/logger';

/**
 * Verifies the Authorization header matches the CRON_SECRET env var.
 * Uses a timing-safe comparison to prevent timing-oracle attacks on the secret.
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

  // Timing-safe comparison — prevents byte-by-byte secret disclosure via
  // response-time oracles. Buffers must be same length before comparing.
  const expected = Buffer.from(`Bearer ${cronSecret}`);
  const received = Buffer.from(authHeader ?? '');

  const isValid =
    expected.length === received.length &&
    timingSafeEqual(expected, received);

  if (!isValid) {
    logger.warn('cron.auth: unauthorized request', {
      path: request.url,
      ip: request.headers.get('x-real-ip') ?? 'unknown',
    });
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  return null; // Authorized — proceed
}
