import { z } from "zod";

// ---------------------------------------------------------------------------
// Listings API query schema — validates GET /api/v1/listings searchParams.
// Field names match the route's existing searchParams keys.
// ---------------------------------------------------------------------------

export const listingsQuerySchema = z.object({
  q: z.string().optional(),
  category: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(48).default(24),
});
