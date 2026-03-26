// src/app/api/stripe/connect/return/route.ts
// ─── Stripe Connect Onboarding Return ───────────────────────────────────────
// Called after seller completes Stripe onboarding.
// Verifies account ownership via metadata.userId, updates DB, then redirects.

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import db from '@/lib/db';
import { stripe } from '@/infrastructure/stripe/client';
import { logger } from '@/shared/logger';

export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(
      new URL('/login?from=/account/stripe', process.env.NEXT_PUBLIC_APP_URL!)
    );
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { stripeAccountId: true },
  });

  if (user?.stripeAccountId) {
    // Verify ownership and check live status
    const account = await stripe.accounts.retrieve(user.stripeAccountId);

    // Enforce ownership: metadata.userId must match the authenticated user.
    // This is set when the account is created in createStripeConnectAccount().
    // If it does not match, reject — do not update any DB state.
    if (account.metadata?.userId !== session.user.id) {
      logger.warn('stripe.connect.ownership_mismatch', {
        userId: session.user.id,
        accountUserId: account.metadata?.userId ?? null,
        accountId: account.id,
      });
      return NextResponse.redirect(
        new URL(
          '/seller/onboarding?error=account_mismatch',
          process.env.NEXT_PUBLIC_APP_URL!
        )
      );
    }

    // Ownership confirmed — sync onboarding status from Stripe
    const onboarded =
      (account.details_submitted ?? false) && (account.charges_enabled ?? false);

    await db.user.update({
      where: { id: session.user.id },
      data: { stripeOnboarded: onboarded },
    });

    logger.info('stripe.connect.return.synced', {
      userId: session.user.id,
      accountId: account.id,
      onboarded,
    });
  }

  return NextResponse.redirect(
    new URL('/account/stripe?success=true', process.env.NEXT_PUBLIC_APP_URL!)
  );
}
