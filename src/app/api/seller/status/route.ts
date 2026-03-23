// src/app/api/seller/status/route.ts
// ─── Seller Onboarding Status ─────────────────────────────────────────────────
// Quick endpoint checked by the /sell page to determine whether to show
// the sell wizard or the Stripe setup gate.

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({
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

  return NextResponse.json({
    authenticated: true,
    stripeOnboarded: user?.stripeOnboarded ?? false,
    hasStripeAccount: !!user?.stripeAccountId,
    sellerEnabled: user?.sellerEnabled ?? false,
  });
}
