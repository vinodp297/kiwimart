'use client'
// src/app/(protected)/seller/onboarding/SellerOnboardingClient.tsx
// ─── Seller Onboarding Client ──────────────────────────────────────────────────

import { useState } from 'react'
import Link from 'next/link'
import { acceptSellerTerms, submitIdVerification } from '@/server/actions/seller'
import type { SellerTier, SellerTierName } from '@/lib/sellerTiers'

interface UserProps {
  id: string
  name: string | null
  email: string
  sellerTermsAcceptedAt: string | null
  phoneVerified: boolean
  idVerified: boolean
  idVerifiedAt: string | null
  idSubmittedAt: string | null
  stripeOnboarded: boolean
}

interface Props {
  user: UserProps
  currentTierName: SellerTierName
  tiers: SellerTier[]
}

const TIER_ORDER: SellerTierName[] = ['basic', 'phone_verified', 'id_verified']

export default function SellerOnboardingClient({ user, currentTierName, tiers }: Props) {
  const [termsAccepted, setTermsAccepted] = useState(!!user.sellerTermsAcceptedAt)
  const [idSubmitted, setIdSubmitted] = useState(!!user.idSubmittedAt)
  const [loading, setLoading] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  async function handleAcceptTerms() {
    setLoading('terms')
    setMessage(null)
    const result = await acceptSellerTerms()
    setLoading(null)
    if (result.success) {
      setTermsAccepted(true)
      setMessage({ type: 'success', text: 'Seller terms accepted.' })
    } else {
      setMessage({ type: 'error', text: result.error ?? 'Something went wrong.' })
    }
  }

  async function handleSubmitId() {
    setLoading('id')
    setMessage(null)
    const result = await submitIdVerification()
    setLoading(null)
    if (result.success) {
      setIdSubmitted(true)
      setMessage({ type: 'success', text: 'ID verification request submitted. We\'ll review it within 1–2 business days.' })
    } else {
      setMessage({ type: 'error', text: result.error ?? 'Something went wrong.' })
    }
  }

  const currentTierIndex = TIER_ORDER.indexOf(currentTierName)

  return (
    <div className="space-y-6">
      {/* Flash message */}
      {message && (
        <div
          className={`rounded-xl border px-4 py-3 text-[13.5px] ${
            message.type === 'success'
              ? 'bg-green-50 border-green-200 text-green-700'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Current tier badge */}
      <div className="bg-white rounded-2xl border border-[#E3E0D9] p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-[11px] text-[#9E9A91] font-medium uppercase tracking-wide mb-1">
              Your Current Tier
            </p>
            <h2 className="font-[family-name:var(--font-playfair)] text-[1.5rem] font-semibold text-[#141414]">
              {tiers.find(t => t.name === currentTierName)?.label}
            </h2>
            <p className="text-[13px] text-[#73706A] mt-1">
              {tiers.find(t => t.name === currentTierName)?.description}
            </p>
          </div>
          <Link
            href="/sell"
            className="shrink-0 inline-flex items-center gap-2 bg-[#141414] text-white text-[13px]
              font-semibold px-4 py-2.5 rounded-xl hover:bg-[#2a2a2a] transition-colors"
          >
            <span>+ Create listing</span>
          </Link>
        </div>

        {/* Perks */}
        <div className="mt-4 flex flex-wrap gap-2">
          {tiers.find(t => t.name === currentTierName)?.perks.map(perk => (
            <span
              key={perk}
              className="inline-flex items-center gap-1.5 text-[11.5px] bg-[#F8F7F4] border border-[#E3E0D9]
                text-[#73706A] px-3 py-1 rounded-full"
            >
              <span className="text-green-600 font-bold">✓</span> {perk}
            </span>
          ))}
        </div>
      </div>

      {/* Tier progression */}
      <div className="bg-white rounded-2xl border border-[#E3E0D9] p-6">
        <h3 className="font-[family-name:var(--font-playfair)] text-[1.1rem] font-semibold text-[#141414] mb-5">
          Seller Tiers
        </h3>

        <div className="space-y-4">
          {tiers.map((tier, i) => {
            const isActive = tier.name === currentTierName
            const isCompleted = i < currentTierIndex
            const isNext = i === currentTierIndex + 1
            const isLocked = i > currentTierIndex + 1

            return (
              <div
                key={tier.name}
                className={`rounded-xl border p-5 transition-all ${
                  isActive
                    ? 'border-[#D4A843] bg-[#F5ECD4]/30'
                    : isCompleted
                    ? 'border-green-200 bg-green-50/50'
                    : 'border-[#E3E0D9]'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-[12px] font-bold ${
                      isCompleted
                        ? 'bg-green-500 text-white'
                        : isActive
                        ? 'bg-[#D4A843] text-white'
                        : 'bg-[#E3E0D9] text-[#9E9A91]'
                    }`}
                  >
                    {isCompleted ? '✓' : i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-[14px] text-[#141414]">{tier.label}</p>
                      {isActive && (
                        <span className="text-[10.5px] bg-[#D4A843] text-white px-2 py-0.5 rounded-full font-medium">
                          Current
                        </span>
                      )}
                      {isCompleted && (
                        <span className="text-[10.5px] bg-green-500 text-white px-2 py-0.5 rounded-full font-medium">
                          Unlocked
                        </span>
                      )}
                      {isLocked && (
                        <span className="text-[10.5px] bg-[#E3E0D9] text-[#9E9A91] px-2 py-0.5 rounded-full font-medium">
                          Locked
                        </span>
                      )}
                    </div>
                    <p className="text-[12.5px] text-[#73706A] mt-0.5">{tier.description}</p>

                    {/* Actions for next tier */}
                    {isNext && (
                      <div className="mt-3 space-y-2">
                        {tier.name === 'phone_verified' && (
                          <div>
                            <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[#E3E0D9] bg-[#FAFAF8] cursor-not-allowed">
                              <span className="text-[13px] text-[#73706A]">📱 Phone verification</span>
                              <span className="ml-auto text-[11px] font-semibold text-[#D4A843] bg-[#FFF9EC] px-2 py-0.5 rounded-full">
                                Coming soon
                              </span>
                            </div>
                            <p className="text-[11px] text-[#C9C5BC] mt-2">
                              SMS verification will be available shortly. ID verification gives you all the same benefits now.
                            </p>
                          </div>
                        )}
                        {tier.name === 'id_verified' && (
                          <div>
                            {user.idVerified ? (
                              <p className="text-[12.5px] text-green-700">ID verified on {user.idVerifiedAt ? new Date(user.idVerifiedAt).toLocaleDateString('en-NZ') : '—'}</p>
                            ) : idSubmitted || user.idSubmittedAt ? (
                              <p className="text-[12.5px] text-amber-700">
                                ID verification pending admin review.
                              </p>
                            ) : (
                              <div className="space-y-2">
                                {!termsAccepted && (
                                  <p className="text-[12.5px] text-[#73706A]">
                                    Accept the seller terms first, then submit your ID.
                                  </p>
                                )}
                                <button
                                  onClick={handleSubmitId}
                                  disabled={!termsAccepted || loading === 'id'}
                                  className="inline-flex items-center gap-2 text-[12.5px] font-semibold
                                    bg-[#141414] text-white px-4 py-2 rounded-lg
                                    hover:bg-[#2a2a2a] disabled:opacity-50 disabled:cursor-not-allowed
                                    transition-colors"
                                >
                                  {loading === 'id' ? 'Submitting…' : 'Request ID Verification'}
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Seller Terms */}
      {!termsAccepted && (
        <div className="bg-white rounded-2xl border border-[#E3E0D9] p-6">
          <h3 className="font-[family-name:var(--font-playfair)] text-[1.1rem] font-semibold text-[#141414] mb-3">
            Seller Terms & Conditions
          </h3>
          <p className="text-[13px] text-[#73706A] mb-4">
            To sell on KiwiMart you must accept our seller terms. This covers our fees (5% + Stripe
            processing), payout schedule, prohibited items, and dispute resolution process.
          </p>
          <ul className="text-[12.5px] text-[#73706A] space-y-1.5 mb-5 list-none">
            {[
              'KiwiMart charges a 5% platform fee on each sale',
              'Payouts are processed via Stripe Connect',
              'You are responsible for accurate listing descriptions',
              'Prohibited items may result in account suspension',
              'Disputes are resolved by KiwiMart at our discretion',
            ].map(term => (
              <li key={term} className="flex items-start gap-2">
                <span className="text-[#D4A843] font-bold mt-0.5">·</span>
                {term}
              </li>
            ))}
          </ul>
          <button
            onClick={handleAcceptTerms}
            disabled={loading === 'terms'}
            className="inline-flex items-center gap-2 bg-[#D4A843] text-white text-[13px]
              font-semibold px-5 py-2.5 rounded-xl hover:bg-[#c49a38]
              disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading === 'terms' ? 'Saving…' : 'Accept Seller Terms'}
          </button>
        </div>
      )}

      {termsAccepted && (
        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-[13px] text-green-700">
          ✓ Seller terms accepted
          {user.sellerTermsAcceptedAt && (
            <span className="text-green-600 ml-1">
              on {new Date(user.sellerTermsAcceptedAt).toLocaleDateString('en-NZ')}
            </span>
          )}
        </div>
      )}

      {/* Stripe CTA */}
      {!user.stripeOnboarded && (
        <div className="bg-white rounded-2xl border border-amber-200 bg-amber-50/50 p-6">
          <div className="flex items-start gap-3">
            <span className="text-2xl">💳</span>
            <div>
              <p className="font-semibold text-[14px] text-[#141414] mb-1">
                Connect Stripe to receive payouts
              </p>
              <p className="text-[12.5px] text-[#73706A] mb-3">
                You need a Stripe account to receive payments from buyers.
              </p>
              <Link
                href="/dashboard/seller"
                className="inline-flex items-center gap-2 text-[12.5px] font-semibold
                  bg-[#635BFF] text-white px-4 py-2 rounded-lg hover:bg-[#5750e5] transition-colors"
              >
                Connect Stripe
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
