// src/app/api/v1/orders/route.ts
// ─── Orders API ──────────────────────────────────────────────────────────────

import { apiOk, handleApiError, requireApiUser, checkApiRateLimit } from '../_helpers/response'
import db from '@/lib/db'

export async function GET(request: Request) {
  // Rate limit: reuse order limiter (5/hr)
  const rateLimited = await checkApiRateLimit(request, 'order')
  if (rateLimited) return rateLimited

  try {
    const user = await requireApiUser()

    const orders = await db.order.findMany({
      where: { buyerId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        status: true,
        totalNzd: true,
        createdAt: true,
        listing: {
          select: { id: true, title: true },
        },
      },
    })

    return apiOk(orders)
  } catch (e) {
    return handleApiError(e)
  }
}
