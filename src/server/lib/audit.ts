// src/server/lib/audit.ts
// ─── Audit Logger ─────────────────────────────────────────────────────────────
// Every significant action (auth, listing, order, payment) writes an immutable
// audit log row. The AuditLog table is append-only — no update/delete operations
// are permitted. In Sprint 5, these logs feed into PostHog analytics.
//
// Failures are non-fatal: audit logging should never block the main action.
// All calls are fire-and-forget (no await) from within server actions.

import type { AuditAction } from '@prisma/client';
import db from '@/lib/db';

interface AuditParams {
  userId?: string | null;
  action: AuditAction;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Write an audit log entry.
 * Fire-and-forget — do NOT await this unless you need the result.
 * Silently catches errors to avoid disrupting the main action.
 *
 * @example
 * // Inside a server action (no await — non-blocking)
 * audit({
 *   userId: session.user.id,
 *   action: 'LISTING_CREATED',
 *   entityType: 'Listing',
 *   entityId: listing.id,
 *   ip,
 * });
 */
export function audit(params: AuditParams): void {
  db.auditLog
    .create({
      data: {
        userId: params.userId ?? null,
        action: params.action,
        entityType: params.entityType ?? null,
        entityId: params.entityId ?? null,
        metadata: params.metadata ?? undefined,
        ip: params.ip ?? null,
        userAgent: params.userAgent ?? null,
      },
    })
    .catch((err) => {
      // Log to stderr but never throw — audit failures are non-fatal
      console.error('[AuditLog] Failed to write entry:', err);
    });
}

