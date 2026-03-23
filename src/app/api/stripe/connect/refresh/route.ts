// src/app/api/stripe/connect/refresh/route.ts
// ─── Stripe Connect Onboarding Refresh ──────────────────────────────────────
// Called when the onboarding link expires. Generates a fresh link and redirects.

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import db from '@/lib/db';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-02-25.clover',
});

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

  if (!user?.stripeAccountId) {
    return NextResponse.redirect(
      new URL('/account/stripe', process.env.NEXT_PUBLIC_APP_URL!)
    );
  }

  const accountLink = await stripe.accountLinks.create({
    account: user.stripeAccountId,
    refresh_url: `${process.env.NEXT_PUBLIC_APP_URL}/api/stripe/connect/refresh`,
    return_url: `${process.env.NEXT_PUBLIC_APP_URL}/api/stripe/connect/return`,
    type: 'account_onboarding',
  });

  return NextResponse.redirect(accountLink.url);
}
