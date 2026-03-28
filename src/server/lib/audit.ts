// src/server/lib/audit.ts
// ─── Audit Logger ─────────────────────────────────────────────────────────────
// Every significant action (auth, listing, order, payment) writes an immutable
// audit log row. The AuditLog table is append-only — no update/delete operations
// are permitted. In Sprint 5, these logs feed into PostHog analytics.
//
// Failures are non-fatal: audit logging should never block the main action.
// All calls are fire-and-forget (no await) from within server actions.

import type { AuditAction, Prisma } from "@prisma/client";
import db from "@/lib/db";
import { logger } from "@/shared/logger";

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
 * Redact PII from audit metadata before DB write.
 *  - email: keep domain only → ***@example.com
 *  - ip: keep first two octets → 192.168.*.*
 *  - userAgent: strip entirely — too identifying
 */
function sanitizeAuditMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!metadata) return metadata;
  const sanitized = { ...metadata };

  if (typeof sanitized.email === "string") {
    const parts = sanitized.email.split("@");
    sanitized.email = parts.length === 2 ? `***@${parts[1]}` : "[redacted]";
  }

  if (typeof sanitized.ip === "string") {
    const octets = sanitized.ip.split(".");
    sanitized.ip =
      octets.length === 4 ? `${octets[0]}.${octets[1]}.*.*` : "[redacted]";
  }

  delete sanitized.userAgent;
  delete sanitized.user_agent;

  return sanitized;
}

/**
 * Redact a raw IP string for DB storage.
 * Keep first two octets only → 192.168.*.*
 */
function redactIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const octets = ip.split(".");
  return octets.length === 4 ? `${octets[0]}.${octets[1]}.*.*` : "[redacted]";
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
  const sanitizedMeta = sanitizeAuditMetadata(params.metadata);
  db.auditLog
    .create({
      data: {
        userId: params.userId ?? null,
        action: params.action,
        entityType: params.entityType ?? null,
        entityId: params.entityId ?? null,
        metadata: (sanitizedMeta ?? undefined) as
          | Prisma.InputJsonValue
          | undefined,
        ip: redactIp(params.ip),
        userAgent: null, // PII — never store raw user-agent
      },
    })
    .catch((err) => {
      logger.error("audit.write.failed", {
        error: err instanceof Error ? err.message : String(err),
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
      });
    });

  // Also emit a structured log line for observability (fire-and-forget DB above)
  logger.info("audit.event", {
    userId: params.userId ?? undefined,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
  });
}
