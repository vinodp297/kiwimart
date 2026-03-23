'use client';
// src/app/(public)/checkout/success/page.tsx
// ─── Checkout Success Page ──────────────────────────────────────────────────

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import NavBar from '@/components/NavBar';
import Footer from '@/components/Footer';
import { Button } from '@/components/ui/primitives';

export default function CheckoutSuccessPage() {
  const searchParams = useSearchParams();
  const orderId = searchParams.get('orderId');

  return (
    <>
      <NavBar />
      <main className="bg-[#FAFAF8] min-h-screen">
        <div className="max-w-lg mx-auto px-4 sm:px-6 py-16 text-center">
          {/* Success icon */}
          <div className="w-20 h-20 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-6">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>

          <h1 className="font-[family-name:var(--font-playfair)] text-[2rem] font-semibold text-[#141414] mb-3">
            Order confirmed!
          </h1>

          {orderId && (
            <p className="text-[13px] text-[#9E9A91] mb-2">
              Order reference: <span className="font-mono text-[#141414]">{orderId.slice(0, 12)}…</span>
            </p>
          )}

          <p className="text-[14px] text-[#73706A] max-w-sm mx-auto mb-8 leading-relaxed">
            Your payment is held safely in escrow until you confirm delivery.
            The seller has been notified and will dispatch your item shortly.
          </p>

          {/* What happens next */}
          <div className="bg-white rounded-2xl border border-[#E3E0D9] p-6 text-left mb-8">
            <h2 className="text-[13.5px] font-semibold text-[#141414] mb-4">
              What happens next
            </h2>
            <div className="space-y-4">
              {[
                {
                  step: '1',
                  title: 'Payment held securely',
                  desc: 'Your funds are held in escrow — the seller is paid only after you confirm delivery.',
                },
                {
                  step: '2',
                  title: 'Seller dispatches',
                  desc: 'The seller will package and ship your item. You\'ll receive tracking details by email.',
                },
                {
                  step: '3',
                  title: 'Confirm delivery',
                  desc: 'Once you receive the item, confirm delivery in your dashboard to release payment.',
                },
              ].map(({ step, title, desc }) => (
                <div key={step} className="flex gap-3">
                  <div className="w-7 h-7 rounded-full bg-[#F8F7F4] border border-[#E3E0D9] flex items-center justify-center shrink-0">
                    <span className="text-[11px] font-bold text-[#141414]">{step}</span>
                  </div>
                  <div>
                    <p className="text-[13px] font-semibold text-[#141414]">{title}</p>
                    <p className="text-[12px] text-[#73706A] mt-0.5">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/dashboard/buyer">
              <Button variant="gold" size="md">
                Track your order
              </Button>
            </Link>
            <Link href="/search">
              <Button variant="secondary" size="md">
                Continue shopping
              </Button>
            </Link>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
