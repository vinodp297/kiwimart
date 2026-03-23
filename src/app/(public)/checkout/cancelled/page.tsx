'use client';
// src/app/(public)/checkout/cancelled/page.tsx
// ─── Checkout Cancelled Page ────────────────────────────────────────────────

import Link from 'next/link';
import NavBar from '@/components/NavBar';
import Footer from '@/components/Footer';
import { Button } from '@/components/ui/primitives';

export default function CheckoutCancelledPage() {
  return (
    <>
      <NavBar />
      <main className="bg-[#FAFAF8] min-h-screen">
        <div className="max-w-lg mx-auto px-4 sm:px-6 py-16 text-center">
          <div className="w-20 h-20 rounded-full bg-amber-50 flex items-center justify-center mx-auto mb-6">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M8 12h8" />
            </svg>
          </div>

          <h1 className="font-[family-name:var(--font-playfair)] text-[2rem] font-semibold text-[#141414] mb-3">
            Payment cancelled
          </h1>
          <p className="text-[14px] text-[#73706A] max-w-sm mx-auto mb-8 leading-relaxed">
            Your payment was not processed and you haven&apos;t been charged.
            The item is still available if you&apos;d like to try again.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button onClick={() => window.history.back()}>
              <Button variant="gold" size="md">
                Try again
              </Button>
            </button>
            <Link href="/search">
              <Button variant="secondary" size="md">
                Browse other items
              </Button>
            </Link>
          </div>

          <p className="text-[12px] text-[#9E9A91] mt-8">
            Having trouble?{' '}
            <Link href="/support" className="text-[#D4A843] hover:text-[#B8912E] transition-colors">
              Contact support
            </Link>
          </p>
        </div>
      </main>
      <Footer />
    </>
  );
}
