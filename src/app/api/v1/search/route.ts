// src/app/api/v1/search/route.ts
// ─── Public Search API ──────────────────────────────────────────────────────

import { searchService } from '@/modules/listings/search.service'
import { apiOk, handleApiError } from '../_helpers/response'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const results = await searchService.searchListings({
      query: searchParams.get('q') ?? undefined,
      category: searchParams.get('category') ?? undefined,
      subcategory: searchParams.get('subcategory') ?? undefined,
      condition: searchParams.get('condition') ?? undefined,
      region: searchParams.get('region') ?? undefined,
      priceMin: searchParams.get('priceMin') ? Number(searchParams.get('priceMin')) : undefined,
      priceMax: searchParams.get('priceMax') ? Number(searchParams.get('priceMax')) : undefined,
      sort: (searchParams.get('sort') as 'newest' | 'oldest' | 'price-asc' | 'price-desc' | 'most-watched') ?? undefined,
      page: searchParams.get('page') ? Number(searchParams.get('page')) : undefined,
      pageSize: searchParams.get('pageSize') ? Number(searchParams.get('pageSize')) : undefined,
    })
    return apiOk(results)
  } catch (e) {
    return handleApiError(e)
  }
}
