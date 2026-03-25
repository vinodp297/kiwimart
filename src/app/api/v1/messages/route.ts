// src/app/api/v1/messages/route.ts
// ─── Messages API ────────────────────────────────────────────────────────────

import { messageService } from '@/modules/messaging/message.service'
import { apiOk, handleApiError, requireApiUser } from '../_helpers/response'

export async function GET() {
  try {
    const user = await requireApiUser()
    const threads = await messageService.getMyThreads(user.id)
    return apiOk(threads)
  } catch (e) {
    return handleApiError(e)
  }
}
