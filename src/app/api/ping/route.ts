// src/app/api/ping/route.ts
// ─── Lightweight uptime ping ───────────────────────────────────────────────────
// No DB or external service calls — responds in < 10ms.
// Use this for uptime monitors that just need a 200 OK.
// Use /api/health for full service-status checks.

export const dynamic = 'force-dynamic'

export async function GET() {
  return Response.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  })
}
