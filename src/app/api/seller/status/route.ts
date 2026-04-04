// src/app/api/seller/status/route.ts
// ─── Seller Onboarding Status ─────────────────────────────────────────────────
// Quick endpoint checked by the /sell page to determine whether to show
// the sell wizard or the Stripe setup gate.

import { auth } from "@/lib/auth";
import db from "@/lib/db";
import { logger } from "@/shared/logger";
import { apiOk, apiError } from "@/app/api/v1/_helpers/response";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return apiOk({
        authenticated: false,
        stripeOnboarded: false,
        sellerEnabled: false,
      });
    }

    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: {
        stripeOnboarded: true,
        stripeAccountId: true,
        sellerEnabled: true,
      },
    });

    return apiOk({
      authenticated: true,
      stripeOnboarded: user?.stripeOnboarded ?? false,
      hasStripeAccount: !!user?.stripeAccountId,
      sellerEnabled: user?.sellerEnabled ?? false,
    });
  } catch (e) {
    logger.error("api.error", {
      path: "/api/seller/status",
      error: e instanceof Error ? e.message : e,
    });
    return apiError(
      "We couldn't check your seller status. Please try again.",
      500,
    );
  }
}
