// src/app/(public)/trust/page.tsx
// ─── Trust & Protection Page ─────────────────────────────────────────────────

import type { Metadata } from 'next';
import NavBar from '@/components/NavBar';
import Footer from '@/components/Footer';
import { Breadcrumb } from '@/components/ui/primitives';

export const metadata: Metadata = {
  title: 'Trust & Protection — KiwiMart',
  description: 'Learn how KiwiMart protects buyers and sellers with secure escrow payments, $3,000 buyer protection, and verified seller accounts.',
};

const PROTECTIONS = [
  {
    title: 'Secure escrow payments',
    description: 'When you buy on KiwiMart, your payment is held in secure escrow until you confirm you\'ve received the item in the described condition. The seller only gets paid once you\'re happy.',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#D4A843" strokeWidth="1.8">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    ),
  },
  {
    title: '$3,000 buyer protection',
    description: 'Every purchase is protected up to $3,000. If your item doesn\'t arrive, is significantly different from the listing, or turns out to be counterfeit, we\'ll issue a full refund.',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#D4A843" strokeWidth="1.8">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
  },
  {
    title: 'Verified sellers',
    description: 'Look for the verified badge — it means the seller has completed NZ identity verification. Verified sellers have proven their identity with a New Zealand driver\'s licence or passport.',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#D4A843" strokeWidth="1.8">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    ),
  },
  {
    title: 'Transparent reviews',
    description: 'Every transaction generates a review opportunity. Sellers can\'t delete negative reviews, and we verify that reviewers actually purchased from the seller.',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#D4A843" strokeWidth="1.8">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    ),
  },
  {
    title: 'Dispute resolution',
    description: 'If something goes wrong, our dedicated NZ-based support team mediates between buyers and sellers. Most disputes are resolved within 48 hours.',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#D4A843" strokeWidth="1.8">
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ),
  },
  {
    title: 'NZ Consumer Guarantees Act',
    description: 'KiwiMart is a New Zealand company. All transactions are covered by the Consumer Guarantees Act 1993, Fair Trading Act 1986, and Sale of Goods Act 1908.',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#D4A843" strokeWidth="1.8">
        <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
        <line x1="4" y1="22" x2="4" y2="15" />
      </svg>
    ),
  },
];

export default function TrustPage() {
  return (
    <>
      <NavBar />
      <main className="bg-[#FAFAF8] min-h-screen">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
          <Breadcrumb items={[
            { label: 'Home', href: '/' },
            { label: 'Trust & Protection' },
          ]} />

          {/* Hero */}
          <div className="mt-8 text-center mb-12">
            <div
              className="w-20 h-20 rounded-full bg-[#F5ECD4] flex items-center justify-center
                mx-auto mb-6"
              aria-hidden
            >
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#D4A843" strokeWidth="1.5">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </div>
            <h1 className="font-[family-name:var(--font-playfair)] text-[2rem] sm:text-[2.5rem]
              font-semibold text-[#141414] mb-4">
              Trust &amp; Protection
            </h1>
            <p className="text-[15px] text-[#73706A] max-w-2xl mx-auto leading-relaxed">
              KiwiMart is built on trust. Every transaction is protected by our secure
              escrow system, $3,000 buyer guarantee, and verified seller programme.
            </p>
          </div>

          {/* Protection cards */}
          <div className="space-y-4 mb-12">
            {PROTECTIONS.map((item) => (
              <div
                key={item.title}
                className="bg-white rounded-2xl border border-[#E3E0D9] p-6
                  flex items-start gap-5"
              >
                <div
                  className="w-12 h-12 rounded-xl bg-[#F5ECD4] flex items-center justify-center
                    shrink-0"
                  aria-hidden
                >
                  {item.icon}
                </div>
                <div>
                  <h2 className="font-semibold text-[#141414] text-[15px] mb-1.5">{item.title}</h2>
                  <p className="text-[13.5px] text-[#73706A] leading-relaxed">{item.description}</p>
                </div>
              </div>
            ))}
          </div>

          {/* CTA */}
          <div className="text-center mb-12">
            <p className="text-[13.5px] text-[#9E9A91] mb-4">
              Have questions about our buyer protection? We&apos;re here to help.
            </p>
            <a
              href="/contact"
              className="inline-flex items-center justify-center h-11 px-7 rounded-full
                bg-[#141414] text-white font-semibold text-[14px]
                hover:bg-[#D4A843] transition-colors"
            >
              Contact our team
            </a>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
