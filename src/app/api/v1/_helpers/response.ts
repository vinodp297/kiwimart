// src/app/api/v1/_helpers/response.ts
// ─── API Response Helpers ────────────────────────────────────────────────────

import { AppError } from '@/shared/errors'
import { auth } from '@/lib/auth'
import db from '@/lib/db'
import { rateLimit, getClientIp, type RateLimitKey } from '@/server/lib/rateLimit'

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

  // Fresh DB lookup — same pattern as requireUser().
  // Session tokens may be stale: soft-deleted or banned users must be rejected.
  const user = await db.user.findUnique({
    where: {
      id: session.user.id,
      deletedAt: null, // Reject soft-deleted accounts
    },
    select: {
      id: true,
      email: true,
      isAdmin: true,
      isBanned: true,
      sellerEnabled: true,
      stripeOnboarded: true,
    },
  })

  if (!user) {
    throw AppError.unauthenticated()
  }

  if (user.isBanned) {
    throw AppError.banned()
  }

  return user
}

/**
 * Apply rate limiting to an API endpoint.
 * Returns a 429 Response if rate-limited, or null if allowed.
 */
export async function checkApiRateLimit(
  request: Request,
  type: RateLimitKey
): Promise<Response | null> {
  const ip = getClientIp(new Headers(request.headers))
  const result = await rateLimit(type, `api:${ip}`)

  if (!result.success) {
    return Response.json(
      {
        success: false,
        error: 'Too many requests',
        retryAfter: result.retryAfter,
        timestamp: new Date().toISOString(),
      },
      {
        status: 429,
        headers: {
          'Retry-After': String(result.retryAfter),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(result.reset),
        },
      }
    )
  }

  return null // Allowed — proceed
}
