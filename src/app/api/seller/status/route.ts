// src/app/api/seller/status/route.ts
// @deprecated — use /api/v1/account or /api/v1/users/me going forward
// ─── Seller Onboarding Status ─────────────────────────────────────────────────
// Quick endpoint checked by the /sell page to determine whether to show
// the sell wizard or the Stripe setup gate.

import { auth } from "@/lib/auth";
import db from "@/lib/db";
import { logger } from "@/shared/logger";
import { apiOk, apiError } from "@/app/api/v1/_helpers/response";

export const dynamic = "force-dynamic";

function dep<T extends Response>(res: T): T {
  res.headers.set("Deprecation", "true");
  res.headers.set(
    "Sunset",
    new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toUTCString(),
  );
  res.headers.set("Link", '</api/v1/>; rel="successor-version"');
  return res;
}

export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return dep(
        apiOk({
          authenticated: false,
          stripeOnboarded: false,
          sellerEnabled: false,
        }),
      );
    }

    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: {
        stripeOnboarded: true,
        stripeAccountId: true,
        sellerEnabled: true,
      },
    });

    return dep(
      apiOk({
        authenticated: true,
        stripeOnboarded: user?.stripeOnboarded ?? false,
        hasStripeAccount: !!user?.stripeAccountId,
        sellerEnabled: user?.sellerEnabled ?? false,
      }),
    );
  } catch (e) {
    logger.error("api.error", {
      path: "/api/seller/status",
      error: e instanceof Error ? e.message : e,
    });
    return dep(
      apiError("We couldn't check your seller status. Please try again.", 500),
    );
  }
}
