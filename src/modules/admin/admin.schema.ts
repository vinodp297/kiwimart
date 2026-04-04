import { z } from "zod";

// ---------------------------------------------------------------------------
// Admin API query schemas — validate GET /api/admin/* searchParams.
// ---------------------------------------------------------------------------

export const adminUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  q: z.string().optional(),
});

export const adminCursorQuerySchema = z.object({
  cursor: z.string().cuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
