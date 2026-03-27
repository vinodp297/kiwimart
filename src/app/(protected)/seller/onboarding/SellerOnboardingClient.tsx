'use client'
// src/app/(protected)/seller/onboarding/SellerOnboardingClient.tsx
// ─── Seller Onboarding Client ──────────────────────────────────────────────────

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
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

// ─── Seller Terms Content ────────────────────────────────────────────────────

const SELLER_TERMS = `KIWIMART SELLER TERMS & CONDITIONS
Last updated: March 2026

1. ELIGIBILITY
You must be 18 years or older and a New Zealand resident or registered NZ business to sell on KiwiMart.

2. LISTING REQUIREMENTS
- All listings must accurately represent the item being sold
- Photos must be of the actual item
- Price must be in NZD
- Condition must be accurately described
- Prohibited items must not be listed

3. PROHIBITED ITEMS
The following are not permitted on KiwiMart:
- Weapons and ammunition
- Illegal goods or substances
- Counterfeit or replica branded items
- Adult content
- Stolen goods
- Items that violate intellectual property

4. FEES & PAYMENTS
- Listing is free
- KiwiMart charges a transaction fee on completed sales
- All payments are processed through KiwiMart's secure escrow system
- Payouts are made within 3 business days of delivery confirmation

5. ESCROW & DELIVERY
- Payment is held in escrow until the buyer confirms receipt
- You must dispatch within 5 business days of receiving an order
- You must provide accurate tracking information

6. DISPUTES
- KiwiMart's dispute resolution decisions are final
- You must respond to disputes within 48 hours
- Failure to respond may result in automatic refund to the buyer

7. SELLER CONDUCT
- You must respond to buyer messages within a reasonable time
- You may not solicit off-platform payments
- You may not engage in price manipulation or fake listings

8. ACCOUNT SUSPENSION
KiwiMart reserves the right to suspend or terminate seller accounts for:
- Policy violations
- High dispute rates
- Negative buyer feedback patterns
- Fraudulent activity

9. CHANGES TO TERMS
KiwiMart may update these terms at any time. Continued use of the platform constitutes acceptance of updated terms.

By accepting, you agree to all terms above and confirm you are eligible to sell on KiwiMart.`

// ─── Terms Modal ─────────────────────────────────────────────────────────────

function TermsModal({
  onAccept,
  onClose,
  loading,
  readOnly = false,
}: {
  onAccept: () => void
  onClose: () => void
  loading: boolean
  readOnly?: boolean
}) {
  const [hasScrolled, setHasScrolled] = useState(false)
  const [checked, setChecked] = useState(false)

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget
    if (scrollTop + clientHeight >= scrollHeight - 30) {
      setHasScrolled(true)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 overflow-y-auto"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="flex min-h-full items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg flex flex-col shadow-2xl my-8">
        {/* Header */}
        <div className="bg-[#141414] px-6 py-4 flex items-center justify-between flex-shrink-0">
          <h2 className="font-semibold text-white text-[16px]">
            Seller Terms & Conditions
          </h2>
          <button
            onClick={onClose}
            className="text-white/60 hover:text-white text-xl leading-none transition-colors"
          >
            &times;
          </button>
        </div>

        {/* Scrollable terms */}
        <div
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto p-6 max-h-[60vh] text-[13px] text-[#73706A] leading-relaxed whitespace-pre-wrap bg-[#FAFAF8]"
        >
          {SELLER_TERMS}
        </div>

        {/* Scroll hint — only when accepting */}
        {!readOnly && !hasScrolled && (
          <div className="bg-[#FFF9EC] border-t border-[#E3E0D9] px-4 py-2 flex-shrink-0">
            <p className="text-[11px] text-[#D4A843] text-center font-medium">
              ↓ Scroll to the bottom to enable acceptance
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="border-t border-[#E3E0D9] p-5 flex-shrink-0 bg-white">
          {readOnly ? (
            /* View-only mode — just a Close button, no checkbox */
            <button
              onClick={onClose}
              className="w-full py-2.5 border border-[#E3E0D9] text-[#73706A] rounded-xl text-[13px] hover:bg-[#F2EFE8] transition-colors"
            >
              Close
            </button>
          ) : (
            /* Accept mode — checkbox + Cancel / Accept */
            <>
              <label
                className={`flex items-start gap-3 mb-4 cursor-pointer ${
                  !hasScrolled ? 'opacity-40 pointer-events-none' : ''
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => setChecked(e.target.checked)}
                  disabled={!hasScrolled}
                  className="mt-0.5 w-4 h-4 accent-[#D4A843] flex-shrink-0"
                />
                <span className="text-[13px] text-[#141414] leading-relaxed">
                  I have read and agree to KiwiMart&apos;s Seller Terms & Conditions
                </span>
              </label>

              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="flex-1 py-2.5 border border-[#E3E0D9] text-[#73706A] rounded-xl text-[13px] hover:bg-[#F2EFE8] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={onAccept}
                  disabled={!checked || !hasScrolled || loading}
                  className="flex-[2] py-2.5 bg-[#D4A843] text-[#141414] rounded-xl font-semibold text-[13px] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#C49B35] transition-colors"
                >
                  {loading ? 'Accepting...' : 'Accept Terms'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      </div>
    </div>
  )
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function SellerOnboardingClient({ user, currentTierName, tiers }: Props) {
  const router = useRouter()
  const [termsAccepted, setTermsAccepted] = useState(!!user.sellerTermsAcceptedAt)
  const [termsAcceptedAt, setTermsAcceptedAt] = useState(user.sellerTermsAcceptedAt)
  const [idSubmitted, setIdSubmitted] = useState(!!user.idSubmittedAt)
  const [loading, setLoading] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [showTermsModal, setShowTermsModal] = useState(false)

  async function handleAcceptTerms() {
    setLoading('terms')
    setMessage(null)
    try {
      const result = await acceptSellerTerms()
      setLoading(null)
      if (result.success) {
        setTermsAccepted(true)
        setTermsAcceptedAt(new Date().toISOString())
        setShowTermsModal(false)
        setMessage({ type: 'success', text: 'Seller terms accepted! You can now create listings.' })
      } else {
        setMessage({ type: 'error', text: result.error ?? 'Something went wrong.' })
      }
    } catch {
      setLoading(null)
      setMessage({ type: 'error', text: 'Failed to accept terms. Please try again.' })
    }
  }

  async function handleSubmitId() {
    setLoading('id')
    setMessage(null)
    const result = await submitIdVerification()
    setLoading(null)
    if (result.success) {
      setIdSubmitted(true)
      setMessage({ type: 'success', text: 'ID verification request submitted. We\'ll review it within 1\u20132 business days.' })
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

      {/* ── Seller Terms — shown at TOP ────────────────────────────────────── */}
      {termsAccepted ? (
        <div className="bg-[#F0FDF4] border border-[#16a34a]/20 rounded-xl p-4 flex items-start gap-3">
          <span className="text-[#16a34a] text-xl flex-shrink-0">✅</span>
          <div className="flex-1">
            <p className="font-semibold text-[14px] text-[#141414]">Seller terms accepted</p>
            <p className="text-[12px] text-[#73706A] mt-0.5">
              {termsAcceptedAt && (
                <>
                  Accepted on{' '}
                  {new Date(termsAcceptedAt).toLocaleDateString('en-NZ', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                  {' · '}
                </>
              )}
              <button
                onClick={() => setShowTermsModal(true)}
                className="text-[#D4A843] hover:underline text-[12px]"
              >
                View terms →
              </button>
            </p>
          </div>
        </div>
      ) : (
        <div className="bg-white border-2 border-[#D4A843] rounded-2xl overflow-hidden">
          <div className="bg-[#141414] px-5 py-4 flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-white text-[15px]">📋 Seller Terms & Conditions</h2>
              <p className="text-[#888] text-[12px] mt-0.5">Required before you can sell</p>
            </div>
            <span className="bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide">
              Action required
            </span>
          </div>
          <div className="p-5">
            <p className="text-[13px] text-[#73706A] leading-relaxed mb-4">
              Before listing items on KiwiMart, you must read and accept our seller terms.
              These cover your obligations as a seller, fee structure, prohibited items,
              and dispute resolution.
            </p>
            <button
              onClick={() => setShowTermsModal(true)}
              className="w-full border-2 border-[#141414] text-[#141414] py-2.5 rounded-xl font-medium text-[14px] hover:bg-[#141414] hover:text-white transition-colors mb-3"
            >
              📄 Read Seller Terms & Conditions
            </button>
            <p className="text-[11px] text-[#C9C5BC] text-center">
              You must read the terms before you can accept them
            </p>
          </div>
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
                              <p className="text-[12.5px] text-green-700">ID verified on {user.idVerifiedAt ? new Date(user.idVerifiedAt).toLocaleDateString('en-NZ') : '\u2014'}</p>
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
                                  {loading === 'id' ? 'Submitting\u2026' : 'Request ID Verification'}
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

      {/* Terms Modal */}
      {showTermsModal && (
        <TermsModal
          onAccept={handleAcceptTerms}
          onClose={() => setShowTermsModal(false)}
          loading={loading === 'terms'}
          readOnly={termsAccepted}
        />
      )}
    </div>
  )
}
