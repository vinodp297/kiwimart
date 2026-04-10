// src/app/api/stripe/connect/return/route.ts
// ─── Stripe Connect Onboarding Return ───────────────────────────────────────
// Called after seller completes Stripe onboarding.
// Verifies account ownership via metadata.userId, updates DB, then redirects.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { userRepository } from "@/modules/users/user.repository";
import { stripe } from "@/infrastructure/stripe/client";
import { logger } from "@/shared/logger";
import { env } from "@/env";

export async function GET(): Promise<NextResponse> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.redirect(
        new URL("/login?from=/account/stripe", env.NEXT_PUBLIC_APP_URL),
      );
    }

    const user = await userRepository.findStripeStatus(session.user.id);

    if (user?.stripeAccountId) {
      // Verify ownership and check live status
      const account = await stripe.accounts.retrieve(user.stripeAccountId);

      // Enforce ownership: metadata.userId must match the authenticated user.
      // This is set when the account is created in createStripeConnectAccount().
      // If it does not match, reject — do not update any DB state.
      if (account.metadata?.userId !== session.user.id) {
        logger.warn("stripe.connect.ownership_mismatch", {
          userId: session.user.id,
          accountUserId: account.metadata?.userId ?? null,
          accountId: account.id,
        });
        return NextResponse.redirect(
          new URL(
            "/seller/onboarding?error=account_mismatch",
            env.NEXT_PUBLIC_APP_URL,
          ),
        );
      }

      // Ownership confirmed — sync onboarding status from Stripe
      const onboarded =
        (account.details_submitted ?? false) &&
        (account.charges_enabled ?? false);

      await userRepository.update(session.user.id, {
        isStripeOnboarded: onboarded,
      });

      logger.info("stripe.connect.return.synced", {
        userId: session.user.id,
        accountId: account.id,
        onboarded,
      });
    }

    return NextResponse.redirect(
      new URL("/account/stripe?success=true", env.NEXT_PUBLIC_APP_URL),
    );
  } catch (e) {
    logger.error("api.error", {
      path: "/api/stripe/connect/return",
      error: e instanceof Error ? e.message : e,
    });
    return NextResponse.json(
      {
        error: `Stripe onboarding couldn't be completed. Please try again or contact ${process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@buyzi.co.nz"}.`,
      },
      { status: 500 },
    );
  }
}
