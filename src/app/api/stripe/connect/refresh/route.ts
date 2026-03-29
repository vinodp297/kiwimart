// src/app/api/stripe/connect/refresh/route.ts
// ─── Stripe Connect Onboarding Refresh ──────────────────────────────────────
// Called when the onboarding link expires. Generates a fresh link and redirects.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import db from "@/lib/db";
import { stripe } from "@/infrastructure/stripe/client";
import { logger } from "@/shared/logger";

export async function GET(): Promise<NextResponse> {
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

    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { stripeAccountId: true },
    });

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
    return NextResponse.json(
      { error: "We couldn't reconnect to Stripe. Please try again." },
      { status: 500 },
    );
  }
}
