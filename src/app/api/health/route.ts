// src/app/api/health/route.ts
// ─── Public Liveness Probe ──────────────────────────────────────────────────
// Returns minimal status only. No dependency details, no error messages.
// Used by: Vercel health checks, Better Uptime.
// For detailed service health, see /api/admin/health (requires SUPER_ADMIN).

export const dynamic = 'force-dynamic'

export async function GET() {
  return Response.json(
    { status: 'ok', timestamp: new Date().toISOString() },
    { status: 200 }
  )
}
