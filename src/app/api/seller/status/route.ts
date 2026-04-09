// src/app/api/seller/status/route.ts
// @deprecated — use /api/v1/account or /api/v1/users/me going forward
// ─── Seller Onboarding Status ─────────────────────────────────────────────────
// Quick endpoint checked by the /sell page to determine whether to show
// the sell wizard or the Stripe setup gate.

import { auth } from "@/lib/auth";
import { userRepository } from "@/modules/users/user.repository";
import { logger } from "@/shared/logger";
import { apiOk, apiError } from "@/app/api/v1/_helpers/response";
import { withDeprecation } from "@/app/api/_helpers/deprecation";
import { MS_PER_DAY } from "@/lib/time";

export const dynamic = "force-dynamic";

const SUNSET = new Date(Date.now() + 90 * MS_PER_DAY);

export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return withDeprecation(
        apiOk({
          authenticated: false,
          isStripeOnboarded: false,
          isSellerEnabled: false,
        }),
        SUNSET,
      );
    }

    const user = await userRepository.findForStripeConnect(session.user.id);

    return withDeprecation(
      apiOk({
        authenticated: true,
        isStripeOnboarded: user?.isStripeOnboarded ?? false,
        hasStripeAccount: !!user?.stripeAccountId,
        isSellerEnabled: user?.isSellerEnabled ?? false,
      }),
      SUNSET,
    );
  } catch (e) {
    logger.error("api.error", {
      path: "/api/seller/status",
      error: e instanceof Error ? e.message : e,
    });
    return withDeprecation(
      apiError("We couldn't check your seller status. Please try again.", 500),
      SUNSET,
    );
  }
}
