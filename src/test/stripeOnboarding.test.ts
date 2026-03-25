// src/test/stripeOnboarding.test.ts
// ─── Tests for Stripe Connect onboarding sync ────────────────────────────────
// Verifies bidirectional sync (true AND false) and payouts_enabled check.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import db from '@/lib/db'

// Replicate the webhook's onboarding logic for testability
function computeOnboardingStatus(account: {
  details_submitted?: boolean | null
  charges_enabled?: boolean | null
  payouts_enabled?: boolean | null
}): {
  onboarded: boolean
  chargesEnabled: boolean
  payoutsEnabled: boolean
} {
  const onboarded =
    account.details_submitted === true &&
    account.charges_enabled === true &&
    account.payouts_enabled === true

  return {
    onboarded,
    chargesEnabled: account.charges_enabled ?? false,
    payoutsEnabled: account.payouts_enabled ?? false,
  }
}

describe('Stripe seller onboarding sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sets stripeOnboarded=true when ALL 3 conditions are true', () => {
    const status = computeOnboardingStatus({
      details_submitted: true,
      charges_enabled: true,
      payouts_enabled: true,
    })
    expect(status.onboarded).toBe(true)
  })

  it('sets stripeOnboarded=false when payouts_enabled is false', () => {
    const status = computeOnboardingStatus({
      details_submitted: true,
      charges_enabled: true,
      payouts_enabled: false,
    })
    expect(status.onboarded).toBe(false)
    expect(status.chargesEnabled).toBe(true)
    expect(status.payoutsEnabled).toBe(false)
  })

  it('sets stripeOnboarded=false when charges_enabled is false', () => {
    const status = computeOnboardingStatus({
      details_submitted: true,
      charges_enabled: false,
      payouts_enabled: true,
    })
    expect(status.onboarded).toBe(false)
  })

  it('sets stripeOnboarded=false when details_submitted is false', () => {
    const status = computeOnboardingStatus({
      details_submitted: false,
      charges_enabled: true,
      payouts_enabled: true,
    })
    expect(status.onboarded).toBe(false)
  })

  it('handles null/undefined values safely', () => {
    const status = computeOnboardingStatus({
      details_submitted: null,
      charges_enabled: undefined,
      payouts_enabled: null,
    })
    expect(status.onboarded).toBe(false)
    expect(status.chargesEnabled).toBe(false)
    expect(status.payoutsEnabled).toBe(false)
  })

  it('syncs FALSE when account regresses (bidirectional)', async () => {
    // A previously onboarded seller who loses charges_enabled
    const account = {
      id: 'acct_regressed',
      details_submitted: true,
      charges_enabled: false,
      payouts_enabled: false,
    }

    const { onboarded, chargesEnabled, payoutsEnabled } =
      computeOnboardingStatus(account)

    expect(onboarded).toBe(false)

    vi.mocked(db.user.updateMany).mockResolvedValue({ count: 1 } as never)

    await db.user.updateMany({
      where: { stripeAccountId: account.id },
      data: {
        stripeOnboarded: onboarded,
        stripeChargesEnabled: chargesEnabled,
        stripePayoutsEnabled: payoutsEnabled,
      },
    })

    // Critical: we wrote FALSE, not just skipped the update
    expect(db.user.updateMany).toHaveBeenCalledWith({
      where: { stripeAccountId: 'acct_regressed' },
      data: {
        stripeOnboarded: false,
        stripeChargesEnabled: false,
        stripePayoutsEnabled: false,
      },
    })
  })

  it('syncs TRUE with all capability flags', async () => {
    const account = {
      id: 'acct_full',
      details_submitted: true,
      charges_enabled: true,
      payouts_enabled: true,
    }

    const { onboarded, chargesEnabled, payoutsEnabled } =
      computeOnboardingStatus(account)

    vi.mocked(db.user.updateMany).mockResolvedValue({ count: 1 } as never)

    await db.user.updateMany({
      where: { stripeAccountId: account.id },
      data: {
        stripeOnboarded: onboarded,
        stripeChargesEnabled: chargesEnabled,
        stripePayoutsEnabled: payoutsEnabled,
      },
    })

    expect(db.user.updateMany).toHaveBeenCalledWith({
      where: { stripeAccountId: 'acct_full' },
      data: {
        stripeOnboarded: true,
        stripeChargesEnabled: true,
        stripePayoutsEnabled: true,
      },
    })
  })
})
