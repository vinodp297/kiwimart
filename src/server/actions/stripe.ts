'use server';
// src/server/actions/stripe.ts
// ─── Stripe Connect Server Actions ──────────────────────────────────────────
// Seller onboarding for Stripe Connect Express accounts.
// Security:
//   • Only authenticated sellers can create/manage Connect accounts
//   • stripeAccountId ownership verified against session.user.id
//   • Onboarding URLs are short-lived and single-use

import { auth } from '@/lib/auth';
import db from '@/lib/db';
import { audit } from '@/server/lib/audit';
import type { ActionResult } from '@/types';
import { stripe } from '@/infrastructure/stripe/client';

// ── createStripeConnectAccount ──────────────────────────────────────────────

export async function createStripeConnectAccount(): Promise<
  ActionResult<{ onboardingUrl: string }>
> {
  // 1. Authenticate
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: 'Authentication required.' };
  }

  // 5a. Check if user already has a Connect account
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      stripeAccountId: true,
      stripeOnboarded: true,
      sellerEnabled: true,
      email: true,
      displayName: true,
    },
  });

  if (!user) return { success: false, error: 'User not found.' };

  if (!user.sellerEnabled) {
    return { success: false, error: 'Seller mode must be enabled first.' };
  }

  // If already has an account, return a fresh onboarding link
  if (user.stripeAccountId) {
    if (user.stripeOnboarded) {
      return { success: false, error: 'Stripe account already connected and active.' };
    }
    // Generate a fresh onboarding link for incomplete accounts
    const accountLink = await stripe.accountLinks.create({
      account: user.stripeAccountId,
      refresh_url: `${process.env.NEXT_PUBLIC_APP_URL}/api/stripe/connect/refresh`,
      return_url: `${process.env.NEXT_PUBLIC_APP_URL}/api/stripe/connect/return`,
      type: 'account_onboarding',
    });
    return { success: true, data: { onboardingUrl: accountLink.url } };
  }

  // 5b. Create Express Connect account
  const account = await stripe.accounts.create({
    type: 'express',
    country: 'NZ',
    email: user.email,
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    business_profile: {
      product_description: `KiwiMart seller: ${user.displayName}`,
    },
    metadata: {
      userId: user.id,
    },
  });

  // 5c. Store account ID on user
  await db.user.update({
    where: { id: user.id },
    data: { stripeAccountId: account.id },
  });

  // 5d. Create onboarding link
  const accountLink = await stripe.accountLinks.create({
    account: account.id,
    refresh_url: `${process.env.NEXT_PUBLIC_APP_URL}/api/stripe/connect/refresh`,
    return_url: `${process.env.NEXT_PUBLIC_APP_URL}/api/stripe/connect/return`,
    type: 'account_onboarding',
  });

  // 6. Audit
  audit({
    userId: user.id,
    action: 'PAYMENT_INITIATED',
    entityType: 'User',
    entityId: user.id,
    metadata: { stripeAccountId: account.id, action: 'connect_account_created' },
  });

  return { success: true, data: { onboardingUrl: accountLink.url } };
}

// ── getStripeOnboardingUrl ──────────────────────────────────────────────────

export async function getStripeOnboardingUrl(): Promise<
  ActionResult<{ onboardingUrl: string }>
> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: 'Authentication required.' };
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { stripeAccountId: true, stripeOnboarded: true },
  });

  if (!user) return { success: false, error: 'User not found.' };
  if (!user.stripeAccountId) {
    return { success: false, error: 'No Stripe account found. Please create one first.' };
  }
  if (user.stripeOnboarded) {
    return { success: false, error: 'Stripe account is already fully onboarded.' };
  }

  const accountLink = await stripe.accountLinks.create({
    account: user.stripeAccountId,
    refresh_url: `${process.env.NEXT_PUBLIC_APP_URL}/api/stripe/connect/refresh`,
    return_url: `${process.env.NEXT_PUBLIC_APP_URL}/api/stripe/connect/return`,
    type: 'account_onboarding',
  });

  return { success: true, data: { onboardingUrl: accountLink.url } };
}

// ── getStripeAccountStatus ──────────────────────────────────────────────────

export async function getStripeAccountStatus(): Promise<
  ActionResult<{
    hasAccount: boolean;
    onboarded: boolean;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
  }>
> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: 'Authentication required.' };
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { stripeAccountId: true, stripeOnboarded: true },
  });

  if (!user) return { success: false, error: 'User not found.' };

  if (!user.stripeAccountId) {
    return {
      success: true,
      data: {
        hasAccount: false,
        onboarded: false,
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
      },
    };
  }

  // Fetch live status from Stripe
  const account = await stripe.accounts.retrieve(user.stripeAccountId);
  const chargesEnabled = account.charges_enabled ?? false;
  const payoutsEnabled = account.payouts_enabled ?? false;
  const detailsSubmitted = account.details_submitted ?? false;
  const onboarded = chargesEnabled && detailsSubmitted;

  // Sync onboarded status if changed
  if (onboarded !== user.stripeOnboarded) {
    await db.user.update({
      where: { id: session.user.id },
      data: { stripeOnboarded: onboarded },
    });
  }

  return {
    success: true,
    data: {
      hasAccount: true,
      onboarded,
      chargesEnabled,
      payoutsEnabled,
      detailsSubmitted,
    },
  };
}
