'use client';
// src/app/(protected)/account/stripe/page.tsx
// ─── Stripe Connect Onboarding Page ─────────────────────────────────────────

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import NavBar from '@/components/NavBar';
import Footer from '@/components/Footer';
import { Button, Alert } from '@/components/ui/primitives';
import {
  createStripeConnectAccount,
  getStripeAccountStatus,
} from '@/server/actions/stripe';

export default function StripeAccountPage() {
  const searchParams = useSearchParams();
  const justReturned = searchParams.get('success') === 'true';

  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<{
    hasAccount: boolean;
    onboarded: boolean;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
  } | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const result = await getStripeAccountStatus();
        if (result.success) {
          setStatus(result.data);
        } else {
          setError(result.error);
        }
      } catch {
        setError('Failed to load Stripe account status.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleConnect() {
    setActionLoading(true);
    setError(null);
    try {
      const result = await createStripeConnectAccount();
      if (result.success) {
        window.location.href = result.data.onboardingUrl;
      } else {
        setError(result.error);
        setActionLoading(false);
      }
    } catch {
      setError('Failed to start Stripe onboarding.');
      setActionLoading(false);
    }
  }

  if (loading) {
    return (
      <>
        <NavBar />
        <main className="bg-[#FAFAF8] min-h-screen">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 py-12">
            <div className="animate-pulse space-y-4">
              <div className="bg-white rounded-2xl border border-[#E3E0D9] h-64" />
            </div>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  const isFullyOnboarded = status?.onboarded && status?.chargesEnabled && status?.payoutsEnabled;
  const isPartiallyOnboarded = status?.hasAccount && !isFullyOnboarded;

  return (
    <>
      <NavBar />
      <main className="bg-[#FAFAF8] min-h-screen">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-12">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-2 text-[12.5px] text-[#9E9A91] mb-6">
            <Link href="/dashboard/seller" className="hover:text-[#D4A843] transition-colors">
              Dashboard
            </Link>
            <span>/</span>
            <Link href="/account/settings" className="hover:text-[#D4A843] transition-colors">
              Account
            </Link>
            <span>/</span>
            <span className="text-[#141414] font-medium">Stripe Payouts</span>
          </nav>

          <h1 className="font-[family-name:var(--font-playfair)] text-[1.75rem] font-semibold text-[#141414] mb-2">
            Payout settings
          </h1>
          <p className="text-[14px] text-[#73706A] mb-8">
            Connect your Stripe account to receive payouts from sales on KiwiMart.
          </p>

          {justReturned && (
            <Alert variant="success" className="mb-6">
              Stripe setup updated successfully. Your account status has been refreshed.
            </Alert>
          )}

          {error && (
            <Alert variant="error" className="mb-6">
              {error}
            </Alert>
          )}

          <div className="bg-white rounded-2xl border border-[#E3E0D9] p-6 sm:p-8">
            {isFullyOnboarded ? (
              /* ── Fully onboarded ──────────────────────────── */
              <div className="text-center py-4">
                <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                </div>
                <h2 className="font-[family-name:var(--font-playfair)] text-[1.25rem] font-semibold text-[#141414] mb-1.5">
                  Payouts active
                </h2>
                <p className="text-[13.5px] text-[#73706A] mb-1">
                  Your Stripe account is fully connected and ready to receive payouts.
                </p>
                <p className="text-[12px] text-[#9E9A91] mb-6">
                  Payouts arrive in your linked NZ bank account within 3 business days of buyer confirmation.
                </p>

                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div className="bg-[#F8F7F4] rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-2 h-2 rounded-full bg-emerald-500" />
                      <span className="text-[12px] font-semibold text-[#141414]">Charges</span>
                    </div>
                    <p className="text-[11.5px] text-[#73706A]">Enabled</p>
                  </div>
                  <div className="bg-[#F8F7F4] rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-2 h-2 rounded-full bg-emerald-500" />
                      <span className="text-[12px] font-semibold text-[#141414]">Payouts</span>
                    </div>
                    <p className="text-[11.5px] text-[#73706A]">Enabled</p>
                  </div>
                </div>

                <Link href="/dashboard/seller">
                  <Button variant="secondary" size="md">
                    Back to dashboard
                  </Button>
                </Link>
              </div>
            ) : isPartiallyOnboarded ? (
              /* ── Partially onboarded ──────────────────────── */
              <div className="text-center py-4">
                <div className="w-16 h-16 rounded-full bg-amber-50 flex items-center justify-center mx-auto mb-4">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                </div>
                <h2 className="font-[family-name:var(--font-playfair)] text-[1.25rem] font-semibold text-[#141414] mb-1.5">
                  Setup incomplete
                </h2>
                <p className="text-[13.5px] text-[#73706A] mb-6">
                  Your Stripe account has been created but setup is not yet complete.
                  Please finish the onboarding process to start receiving payouts.
                </p>

                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div className="bg-[#F8F7F4] rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <div className={`w-2 h-2 rounded-full ${status?.detailsSubmitted ? 'bg-emerald-500' : 'bg-amber-400'}`} />
                      <span className="text-[12px] font-semibold text-[#141414]">Details</span>
                    </div>
                    <p className="text-[11.5px] text-[#73706A]">
                      {status?.detailsSubmitted ? 'Submitted' : 'Pending'}
                    </p>
                  </div>
                  <div className="bg-[#F8F7F4] rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <div className={`w-2 h-2 rounded-full ${status?.chargesEnabled ? 'bg-emerald-500' : 'bg-amber-400'}`} />
                      <span className="text-[12px] font-semibold text-[#141414]">Charges</span>
                    </div>
                    <p className="text-[11.5px] text-[#73706A]">
                      {status?.chargesEnabled ? 'Enabled' : 'Pending'}
                    </p>
                  </div>
                </div>

                <Button
                  variant="gold"
                  size="lg"
                  onClick={handleConnect}
                  loading={actionLoading}
                >
                  Complete setup
                </Button>
              </div>
            ) : (
              /* ── No account ───────────────────────────────── */
              <div className="text-center py-4">
                <div className="w-16 h-16 rounded-full bg-[#F5ECD4]/50 flex items-center justify-center mx-auto mb-4">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#D4A843" strokeWidth="2">
                    <line x1="12" y1="1" x2="12" y2="23" />
                    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                  </svg>
                </div>
                <h2 className="font-[family-name:var(--font-playfair)] text-[1.25rem] font-semibold text-[#141414] mb-1.5">
                  Connect Stripe
                </h2>
                <p className="text-[13.5px] text-[#73706A] max-w-sm mx-auto mb-6">
                  Link your Stripe account to receive payouts when buyers purchase your
                  listings. Setup takes about 5 minutes.
                </p>

                <div className="bg-[#F8F7F4] rounded-xl p-4 mb-6 text-left space-y-3">
                  {[
                    { text: 'Secure payments via Stripe', icon: '🔒' },
                    { text: 'Payouts to your NZ bank account', icon: '🏦' },
                    { text: 'No monthly fees — only pay when you sell', icon: '💰' },
                    { text: 'Supports card and Afterpay payments', icon: '💳' },
                  ].map(({ text, icon }) => (
                    <div key={text} className="flex items-center gap-3">
                      <span className="text-[16px]">{icon}</span>
                      <span className="text-[13px] text-[#141414]">{text}</span>
                    </div>
                  ))}
                </div>

                <Button
                  variant="gold"
                  size="lg"
                  fullWidth
                  onClick={handleConnect}
                  loading={actionLoading}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="12" y1="1" x2="12" y2="23" />
                    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                  </svg>
                  Connect with Stripe
                </Button>

                <p className="text-[11.5px] text-[#9E9A91] mt-4">
                  You&apos;ll be redirected to Stripe to complete identity verification
                  and bank account setup.
                </p>
              </div>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
