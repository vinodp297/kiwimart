// src/app/api/v1/_helpers/response.ts
// ─── API Response Helpers ────────────────────────────────────────────────────

import { AppError } from '@/shared/errors'
import { auth } from '@/lib/auth'

export function apiOk<T>(data: T, status = 200): Response {
  return Response.json(
    {
      success: true,
      data,
      timestamp: new Date().toISOString(),
    },
    { status }
  )
}

export function apiError(message: string, status: number, code?: string): Response {
  return Response.json(
    {
      success: false,
      error: message,
      code,
      timestamp: new Date().toISOString(),
    },
    { status }
  )
}

export function handleApiError(e: unknown): Response {
  if (e instanceof AppError) {
    return apiError(e.message, e.statusCode, e.code)
  }
  return apiError('Internal server error', 500)
}

export async function requireApiUser() {
  const session = await auth()
  if (!session?.user?.id) {
    throw AppError.unauthenticated()
  }
  if (session.user.isBanned) {
    throw AppError.banned()
  }
  return session.user
}
