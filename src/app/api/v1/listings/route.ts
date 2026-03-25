// src/app/api/v1/listings/route.ts
// ─── Listings API ────────────────────────────────────────────────────────────

import { searchService } from '@/modules/listings/search.service'
import { apiOk, handleApiError } from '../_helpers/response'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const results = await searchService.searchListings({
      query: searchParams.get('q') ?? undefined,
      category: searchParams.get('category') ?? undefined,
      page: searchParams.get('page') ? Number(searchParams.get('page')) : undefined,
      pageSize: searchParams.get('pageSize') ? Number(searchParams.get('pageSize')) : undefined,
    })
    return apiOk(results)
  } catch (e) {
    return handleApiError(e)
  }
}
