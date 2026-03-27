// src/app/api/v1/messages/route.ts
// ─── Messages API ────────────────────────────────────────────────────────────

import { messageService } from '@/modules/messaging/message.service'
import { apiOk, handleApiError, requireApiUser, checkApiRateLimit } from '../_helpers/response'

export async function GET(request: Request) {
  // Rate limit: reuse message limiter (20/min)
  const rateLimited = await checkApiRateLimit(request, 'message')
  if (rateLimited) return rateLimited

  try {
    const user = await requireApiUser()
    const threads = await messageService.getMyThreads(user.id)
    return apiOk(threads)
  } catch (e) {
    return handleApiError(e)
  }
}
