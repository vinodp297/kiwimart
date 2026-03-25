// src/modules/listings/listing.types.ts
// ─── Listing Domain Types ────────────────────────────────────────────────────

export interface SearchParams {
  query?: string
  category?: string
  subcategory?: string
  condition?: string
  region?: string
  priceMin?: number
  priceMax?: number
  sort?: 'newest' | 'oldest' | 'price-asc' | 'price-desc' | 'most-watched'
  page?: number
  pageSize?: number
}

export interface SearchResult {
  listings: import('@/types').ListingCard[]
  totalCount: number
  page: number
  pageSize: number
  totalPages: number
  hasNextPage: boolean
}
