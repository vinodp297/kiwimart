// src/server/actions/search.ts
// ─── Listing Search — thin wrapper ──────────────────────────────────────────
// Business logic delegated to SearchService.

import { searchService } from '@/modules/listings/search.service'
import type { SearchParams, SearchResult } from '@/modules/listings/listing.types'

export type { SearchParams, SearchResult }

export async function searchListings(rawParams: SearchParams): Promise<SearchResult> {
  return searchService.searchListings(rawParams)
}
