// src/app/(protected)/seller/onboarding/page.tsx
// ─── Seller Onboarding Hub ─────────────────────────────────────────────────────

import { redirect } from 'next/navigation'
import NavBar from '@/components/NavBar'
import Footer from '@/components/Footer'
import { auth } from '@/lib/auth'
import db from '@/lib/db'
import { getSellerTier, SELLER_TIERS } from '@/lib/sellerTiers'
import SellerOnboardingClient from './SellerOnboardingClient'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Seller Hub — KiwiMart' }
export const dynamic = 'force-dynamic'

export default async function SellerOnboardingPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/auth/signin')

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      displayName: true,
      email: true,
      sellerEnabled: true,
      sellerTermsAcceptedAt: true,
      phoneVerified: true,
      idVerified: true,
      idVerifiedAt: true,
      idSubmittedAt: true,
      stripeOnboarded: true,
    },
  })

  if (!user) redirect('/auth/signin')
  if (!user.sellerEnabled) redirect('/dashboard/buyer')

  const tier = getSellerTier(user)

  return (
    <>
      <NavBar />
      <main className="bg-[#FAFAF8] min-h-screen">
        {/* Header band */}
        <div className="bg-[#141414] text-white">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
            <div className="flex items-center gap-3 mb-1">
              <span className="text-[#D4A843] text-xl">🌿</span>
              <h1 className="font-[family-name:var(--font-playfair)] text-[1.75rem] font-semibold">
                Seller Hub
              </h1>
            </div>
            <p className="text-white/50 text-[13.5px]">
              Manage your seller profile and unlock higher tiers
            </p>
          </div>
        </div>

        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
          <SellerOnboardingClient
            user={{
              id: user.id,
              name: user.displayName,
              email: user.email,
              sellerTermsAcceptedAt: user.sellerTermsAcceptedAt?.toISOString() ?? null,
              phoneVerified: user.phoneVerified,
              idVerified: user.idVerified,
              idVerifiedAt: user.idVerifiedAt?.toISOString() ?? null,
              idSubmittedAt: user.idSubmittedAt?.toISOString() ?? null,
              stripeOnboarded: user.stripeOnboarded,
            }}
            currentTierName={tier.name}
            tiers={Object.values(SELLER_TIERS)}
          />
        </div>
      </main>
      <Footer />
    </>
  )
}
