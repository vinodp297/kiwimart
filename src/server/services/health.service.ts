// src/server/services/health.service.ts
// ─── Health Service ──────────────────────────────────────────────────────────
// Thin wrapper around the database ping used by health-check routes.
// Keeps raw db access out of route files.

import db from "@/lib/db";

export const healthService = {
  /** Run a lightweight DB query to confirm the database is reachable.
   * Throws on failure; callers wrap with try/catch or withTimeout. */
  async pingDatabase(): Promise<void> {
    await db.$queryRaw`SELECT 1`;
  },
};
