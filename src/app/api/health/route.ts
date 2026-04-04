// src/app/api/health/route.ts
// ─── Public Liveness Probe ──────────────────────────────────────────────────
// Returns minimal status only. No dependency details, no error messages.
// Used by: Vercel health checks, Better Uptime.
// For detailed service health, see /api/admin/health (requires SUPER_ADMIN).

import db from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, { status: string; message?: string }> = {};

  // Search vector health: detect stale listings missing searchVector
  try {
    const searchVectorCheck = await db.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) as count
      FROM "Listing"
      WHERE status = 'ACTIVE'
      AND "searchVector" IS NULL
      AND "createdAt" > NOW() - INTERVAL '1 hour'
    `;
    const staleSearchVectors = Number(searchVectorCheck[0]?.count ?? 0);
    if (staleSearchVectors > 0) {
      checks.searchVector = {
        status: "degraded",
        message: `${staleSearchVectors} active listings missing search vector`,
      };
    } else {
      checks.searchVector = { status: "ok" };
    }
  } catch {
    checks.searchVector = { status: "unknown" };
  }

  const overallStatus = Object.values(checks).some(
    (c) => c.status === "degraded",
  )
    ? "degraded"
    : "ok";

  return Response.json(
    { status: overallStatus, checks, timestamp: new Date().toISOString() },
    { status: 200 },
  );
}
