// src/lib/fire-and-forget.ts
// ─── Structured Fire-and-Forget ──────────────────────────────────────────────
// Replaces bare .catch(() => {}) with proper error logging.
// Use for non-critical side effects (notifications, metrics) that should
// never block the main operation but must never silently swallow failures.

import { logger } from "@/shared/logger";

export function fireAndForget(
  promise: Promise<unknown>,
  context: string,
  metadata?: Record<string, unknown>,
): void {
  promise.catch((error) => {
    logger.error(`${context}.failed`, {
      error: error instanceof Error ? error.message : String(error),
      ...metadata,
    });
  });
}
