// src/app/api/v1/fees/preview/route.ts
// ─── Public Fee Preview API ───────────────────────────────────────────────────
// GET /api/v1/fees/preview?amount=10000&tier=STANDARD
//
// Returns a FeeBreakdown for the given gross amount and optional seller tier.
// Public endpoint — no auth required. Rate limited at publicRead (fail-open).
//
// Query params:
//   amount  integer cents, required, 1–50_000_000
//   tier    "GOLD" | "SILVER" | "BRONZE" | "STANDARD" (optional, defaults STANDARD)

import { z } from "zod";
import {
  apiOk,
  apiError,
  handleApiError,
  checkApiRateLimit,
} from "../../_helpers/response";
import { getCorsHeaders, withCors } from "../../_helpers/cors";
import { calculateFees } from "@/modules/payments/fee-calculator";
import type { PerformanceTier } from "@/lib/seller-tiers";

const VALID_TIERS = new Set(["GOLD", "SILVER", "BRONZE", "STANDARD"]);

const previewSchema = z.object({
  amount: z
    .string()
    .regex(/^\d+$/, "amount must be a positive integer (cents)")
    .transform(Number)
    .pipe(z.number().int().min(1).max(50_000_000)),
  tier: z.string().optional(),
});

export async function GET(request: Request) {
  const rateLimited = await checkApiRateLimit(request, "publicRead");
  if (rateLimited) return rateLimited;

  try {
    const { searchParams } = new URL(request.url);

    let params: { amount: number; tier?: string };
    try {
      params = previewSchema.parse(Object.fromEntries(searchParams));
    } catch (err) {
      if (err instanceof z.ZodError) {
        return withCors(
          apiError("Invalid parameters", 400, "VALIDATION_ERROR"),
          request.headers.get("origin"),
        );
      }
      throw err;
    }

    const { amount, tier } = params;

    if (tier && !VALID_TIERS.has(tier)) {
      return withCors(
        apiError(
          `Invalid tier. Must be one of: ${[...VALID_TIERS].join(", ")}`,
          400,
          "VALIDATION_ERROR",
        ),
        request.headers.get("origin"),
      );
    }

    // Map "STANDARD" → null (calculateFees treats null as Standard tier)
    const sellerTier: PerformanceTier =
      tier === "GOLD" || tier === "SILVER" || tier === "BRONZE"
        ? (tier as PerformanceTier)
        : null;

    const breakdown = await calculateFees(amount, sellerTier);

    const res = withCors(apiOk({ breakdown }), request.headers.get("origin"));
    res.headers.set("Cache-Control", "public, max-age=300"); // 5 min — rates change rarely
    return res;
  } catch (e) {
    return withCors(handleApiError(e), request.headers.get("origin"));
  }
}

export async function OPTIONS(request: Request) {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(request.headers.get("origin")),
  });
}
