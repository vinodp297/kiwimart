// src/server/actions/search.ts
// ─── Listing Search ───────────────────────────────────────────────────────────
// Server-side search using Postgres full-text search (tsvector/tsquery).
// The searchVector column is maintained by a Postgres trigger (see migration).
//
// Search strategy:
//   1. Full-text search on title + description (weighted: title A, description B)
//   2. Filter by category, condition, region, price range
//   3. Sort by relevance | newest | price | watchers
//   4. Cursor-based pagination (keyset — no OFFSET for performance)
//
// Sprint 5: add Elastic/Typesense for more sophisticated ranking

import db from '@/lib/db';
import { Prisma } from '@prisma/client';
import type { ListingCard } from '@/types';

export interface SearchParams {
  query?: string;
  category?: string;
  subcategory?: string;
  condition?: string;
  region?: string;
  priceMin?: number;  // NZD dollars
  priceMax?: number;  // NZD dollars
  sort?: 'newest' | 'oldest' | 'price-asc' | 'price-desc' | 'most-watched';
  page?: number;
  pageSize?: number;
}

export interface SearchResult {
  listings: ListingCard[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNextPage: boolean;
}

export async function searchListings(params: SearchParams): Promise<SearchResult> {
  const {
    query,
    category,
    subcategory,
    condition,
    region,
    priceMin,
    priceMax,
    sort = 'newest',
    page = 1,
    pageSize = 24,
  } = params;

  const trimmedQuery = query?.trim() || '';
  const useFts = trimmedQuery.length > 0;

  // Build Prisma where clause (without the FTS part — that's handled via raw SQL)
  const where: Prisma.ListingWhereInput = {
    status: 'ACTIVE',
    deletedAt: null,
    ...(category ? { categoryId: category } : {}),
    ...(subcategory ? { subcategoryName: { equals: subcategory, mode: 'insensitive' as const } } : {}),
    ...(condition ? { condition: condition.toUpperCase() as Prisma.EnumListingConditionFilter } : {}),
    ...(region ? { region: { equals: region, mode: 'insensitive' as const } } : {}),
    ...(priceMin != null || priceMax != null
      ? {
          priceNzd: {
            ...(priceMin != null ? { gte: Math.round(priceMin * 100) } : {}),
            ...(priceMax != null ? { lte: Math.round(priceMax * 100) } : {}),
          },
        }
      : {}),
  };

  // For FTS queries, we need to filter by searchVector using raw SQL
  // We add an id-based filter from the FTS results to the Prisma query
  if (useFts) {
    try {
      // Get matching IDs from the FTS index
      const ftsIds = await db.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Listing"
        WHERE "searchVector" @@ plainto_tsquery('english', ${trimmedQuery})
          AND status = 'ACTIVE'
          AND "deletedAt" IS NULL
        LIMIT 500
      `;
      const idList = ftsIds.map((r) => r.id);
      if (idList.length === 0) {
        // No FTS results — return empty
        return {
          listings: [],
          totalCount: 0,
          page,
          pageSize,
          totalPages: 0,
          hasNextPage: false,
        };
      }
      where.id = { in: idList };
    } catch {
      // FTS not available (trigger not yet installed) — fall back to ILIKE
      where.OR = [
        { title: { contains: trimmedQuery, mode: 'insensitive' as const } },
        { description: { contains: trimmedQuery, mode: 'insensitive' as const } },
      ];
    }
  }

  // Sort order
  const orderBy: Prisma.ListingOrderByWithRelationInput = (() => {
    switch (sort) {
      case 'oldest':    return { createdAt: 'asc' as const };
      case 'price-asc': return { priceNzd: 'asc' as const };
      case 'price-desc':return { priceNzd: 'desc' as const };
      case 'most-watched': return { watcherCount: 'desc' as const };
      default:          return { createdAt: 'desc' as const }; // newest
    }
  })();

  const skip = (page - 1) * pageSize;

  // Run count and data queries in parallel
  const [totalCount, rows] = await Promise.all([
    db.listing.count({ where }),
    db.listing.findMany({
      where,
      orderBy,
      skip,
      take: pageSize,
      select: {
        id: true,
        title: true,
        priceNzd: true,
        condition: true,
        categoryId: true,
        subcategoryName: true,
        region: true,
        suburb: true,
        shippingOption: true,
        shippingNzd: true,
        offersEnabled: true,
        status: true,
        viewCount: true,
        watcherCount: true,
        createdAt: true,
        images: {
          where: { order: 0, safe: true }, // only cover image
          select: { r2Key: true, thumbnailKey: true },
          take: 1,
        },
        seller: {
          select: {
            username: true,
            displayName: true,
            idVerified: true,
            _count: {
              select: { reviews: true },
            },
          },
        },
      },
    }),
  ]);

  // Map DB rows to ListingCard shape (Sprint 2 type)
  const listings: ListingCard[] = rows.map((row) => ({
    id: row.id,
    title: row.title,
    price: row.priceNzd / 100,
    condition: mapCondition(row.condition),
    categoryName: row.categoryId,         // Sprint 4: join with Category table
    subcategoryName: row.subcategoryName ?? '',
    region: row.region as ListingCard['region'],
    suburb: row.suburb,
    thumbnailUrl: (() => {
      const img = row.images[0];
      if (!img) return 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=480&h=480&fit=crop';
      const key = img.thumbnailKey ?? img.r2Key;
      return key.startsWith('http') ? key : `https://r2.kiwimart.co.nz/${key}`;
    })(),
    sellerName: row.seller.displayName,
    sellerUsername: row.seller.username,
    sellerRating: 4.5,                    // Sprint 4: compute from reviews aggregate
    sellerVerified: row.seller.idVerified,
    viewCount: row.viewCount,
    watcherCount: row.watcherCount,
    createdAt: row.createdAt.toISOString(),
    status: row.status.toLowerCase() as ListingCard['status'],
    shippingOption: row.shippingOption.toLowerCase() as ListingCard['shippingOption'],
    shippingPrice: row.shippingNzd != null ? row.shippingNzd / 100 : null,
    offersEnabled: row.offersEnabled,
  }));

  const totalPages = Math.ceil(totalCount / pageSize);

  return {
    listings,
    totalCount,
    page,
    pageSize,
    totalPages,
    hasNextPage: page < totalPages,
  };
}

// ── mapCondition — Prisma enum → app enum ─────────────────────────────────────

function mapCondition(c: string): ListingCard['condition'] {
  const map: Record<string, ListingCard['condition']> = {
    NEW: 'new',
    LIKE_NEW: 'like-new',
    GOOD: 'good',
    FAIR: 'fair',
    PARTS: 'parts',
  };
  return map[c] ?? 'good';
}

