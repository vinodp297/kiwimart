// src/app/api/stripe/connect/refresh/route.ts
// ─── Stripe Connect Onboarding Refresh ──────────────────────────────────────
// Called when the onboarding link expires. Generates a fresh link and redirects.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { userRepository } from "@/modules/users/user.repository";
import { stripe } from "@/infrastructure/stripe/client";
import { logger } from "@/shared/logger";
import { apiError } from "@/app/api/v1/_helpers/response";

export async function GET(): Promise<NextResponse | Response> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.redirect(
        new URL(
          "/login?from=/account/stripe",
          process.env.NEXT_PUBLIC_APP_URL!,
        ),
      );
    }

    const user = await userRepository.findStripeStatus(session.user.id);

    if (!user?.stripeAccountId) {
      return NextResponse.redirect(
        new URL("/account/stripe", process.env.NEXT_PUBLIC_APP_URL!),
      );
    }

    const accountLink = await stripe.accountLinks.create({
      account: user.stripeAccountId,
      refresh_url: `${process.env.NEXT_PUBLIC_APP_URL}/api/stripe/connect/refresh`,
      return_url: `${process.env.NEXT_PUBLIC_APP_URL}/api/stripe/connect/return`,
      type: "account_onboarding",
    });

    return NextResponse.redirect(accountLink.url);
  } catch (e) {
    logger.error("api.error", {
      path: "/api/stripe/connect/refresh",
      error: e instanceof Error ? e.message : e,
    });
    return apiError("We couldn't reconnect to Stripe. Please try again.", 500);
  }
}
