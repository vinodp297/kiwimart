// src/app/api/v1/users/me/route.ts
// ─── Current User API ───────────────────────────────────────────────────────

import { apiOk, handleApiError, requireApiUser } from '../../_helpers/response'
import db from '@/lib/db'

export async function GET() {
  try {
    const sessionUser = await requireApiUser()

    const user = await db.user.findUnique({
      where: { id: sessionUser.id },
      select: {
        id: true,
        username: true,
        displayName: true,
        email: true,
        avatarKey: true,
        region: true,
        bio: true,
        sellerEnabled: true,
        stripeOnboarded: true,
        idVerified: true,
        phoneVerified: true,
        createdAt: true,
      },
    })

    if (!user) {
      return Response.json({ success: false, error: 'User not found' }, { status: 404 })
    }

    return apiOk(user)
  } catch (e) {
    return handleApiError(e)
  }
}
