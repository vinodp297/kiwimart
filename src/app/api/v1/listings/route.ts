// src/app/api/v1/listings/route.ts
// ─── Listings API ────────────────────────────────────────────────────────────

import { searchService } from '@/modules/listings/search.service'
import { apiOk, handleApiError, checkApiRateLimit } from '../_helpers/response'

export async function GET(request: Request) {
  // Rate limit: reuse listing limiter (10/hr matches server action)
  const rateLimited = await checkApiRateLimit(request, 'listing')
  if (rateLimited) return rateLimited

  try {
    const { searchParams } = new URL(request.url)
    const results = await searchService.searchListings({
      query: searchParams.get('q') ?? undefined,
      category: searchParams.get('category') ?? undefined,
      page: searchParams.get('page') ? Number(searchParams.get('page')) : undefined,
      pageSize: Math.min(Number(searchParams.get('pageSize')) || 24, 48),
    })
    return apiOk(results)
  } catch (e) {
    return handleApiError(e)
  }
}
