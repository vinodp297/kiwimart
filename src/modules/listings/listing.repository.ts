// src/modules/listings/listing.repository.ts (barrel — under 50 lines)
// ─── Re-exports from focused sub-files ───────────────────────────────────────

export type { DbClient } from "@/lib/db";
export type {
  RECOMMENDATION_SELECT,
  RecommendationRow,
  ListingWithRelations,
  ListingWithImages,
  SitemapListing,
  SitemapSeller,
} from "./listing-query.repository";
export {
  getSitemapListings,
  getSitemapSellers,
} from "./listing-query.repository";

import { listingQueryRepository } from "./listing-query.repository";
import { listingMutationRepository } from "./listing-mutation.repository";

export const listingRepository = {
  ...listingQueryRepository,
  ...listingMutationRepository,
};
