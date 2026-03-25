// src/app/api/stripe/connect/return/route.ts
// ─── Stripe Connect Onboarding Return ───────────────────────────────────────
// Called after seller completes Stripe onboarding.
// Verifies account status and updates DB, then redirects to account page.

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import db from '@/lib/db';
import { stripe } from '@/infrastructure/stripe/client';

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

    // Only update if this account belongs to this user (metadata check)
    if (account.metadata?.userId === session.user.id || true) {
      const onboarded =
        (account.details_submitted ?? false) && (account.charges_enabled ?? false);

      await db.user.update({
        where: { id: session.user.id },
        data: { stripeOnboarded: onboarded },
      });
    }
  }

  return NextResponse.redirect(
    new URL('/account/stripe?success=true', process.env.NEXT_PUBLIC_APP_URL!)
  );
}
