// src/app/(public)/safety/page.tsx
// ─── Safety Guide Page ───────────────────────────────────────────────────────

import type { Metadata } from 'next';
import NavBar from '@/components/NavBar';
import Footer from '@/components/Footer';
import { Breadcrumb } from '@/components/ui/primitives';

export const metadata: Metadata = {
  title: 'Safety Guide — KiwiMart',
  description: 'Stay safe when buying and selling on KiwiMart. Tips for safe transactions, meeting in person, and protecting your account.',
};

const SAFETY_TIPS = [
  {
    icon: '🔒',
    title: 'Always use KiwiMart Payments',
    description: 'Our secure escrow system holds payment until you confirm delivery. Never pay by direct bank transfer — you lose all buyer protection.',
  },
  {
    icon: '🛡',
    title: '$3,000 Buyer Protection',
    description: 'Every purchase through KiwiMart Payments is covered up to $3,000. If your item doesn\'t arrive or isn\'t as described, we\'ll refund you.',
  },
  {
    icon: '📍',
    title: 'Meet safely for pickups',
    description: 'Choose a public, well-lit location. Police stations often have designated safe exchange zones. Bring a friend if the item is high value.',
  },
  {
    icon: '🔍',
    title: 'Check seller profiles',
    description: 'Look for the verified badge, review history, and member-since date. Established sellers with positive reviews are generally more trustworthy.',
  },
  {
    icon: '⚠️',
    title: 'Red flags to watch for',
    description: 'Be cautious of prices that seem too good to be true, sellers who pressure you to pay quickly, or anyone who asks you to communicate outside KiwiMart.',
  },
  {
    icon: '📱',
    title: 'Verify your identity',
    description: 'Add a verified phone number and complete ID verification to build trust with other members and unlock all platform features.',
  },
  {
    icon: '🚫',
    title: 'Report suspicious activity',
    description: 'If something doesn\'t feel right, report it immediately. Our Trust & Safety team reviews every report within 24 hours.',
  },
  {
    icon: '🇳🇿',
    title: 'Know your rights',
    description: 'As a New Zealand consumer, you\'re protected by the Consumer Guarantees Act. Goods must be of acceptable quality, fit for purpose, and match their description.',
  },
];

export default function SafetyPage() {
  return (
    <>
      <NavBar />
      <main className="bg-[#FAFAF8] min-h-screen">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
          <Breadcrumb items={[
            { label: 'Home', href: '/' },
            { label: 'Safety Guide' },
          ]} />

          {/* Hero */}
          <div className="mt-8 text-center mb-12">
            <h1 className="font-[family-name:var(--font-playfair)] text-[2rem] sm:text-[2.5rem]
              font-semibold text-[#141414] mb-4">
              Stay safe on KiwiMart
            </h1>
            <p className="text-[15px] text-[#73706A] max-w-2xl mx-auto leading-relaxed">
              Your safety is our priority. Follow these guidelines to protect yourself
              when buying and selling on New Zealand&apos;s trusted marketplace.
            </p>
          </div>

          {/* Safety tips grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-12">
            {SAFETY_TIPS.map((tip) => (
              <div
                key={tip.title}
                className="bg-white rounded-2xl border border-[#E3E0D9] p-6
                  hover:border-[#D4A843]/40 transition-colors"
              >
                <span className="text-2xl mb-3 block" aria-hidden>{tip.icon}</span>
                <h2 className="font-semibold text-[#141414] text-[15px] mb-2">{tip.title}</h2>
                <p className="text-[13px] text-[#73706A] leading-relaxed">{tip.description}</p>
              </div>
            ))}
          </div>

          {/* Emergency banner */}
          <div className="bg-[#141414] rounded-2xl p-8 text-center mb-12">
            <h2 className="font-[family-name:var(--font-playfair)] text-[1.5rem]
              font-semibold text-white mb-3">
              Something wrong?
            </h2>
            <p className="text-[14px] text-white/60 mb-6 max-w-lg mx-auto">
              If you believe you&apos;ve been scammed or feel unsafe, contact our Trust &amp; Safety
              team immediately. We respond to urgent reports within 2 hours.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <a
                href="/report"
                className="inline-flex items-center justify-center h-11 px-7 rounded-full
                  bg-[#D4A843] text-[#141414] font-semibold text-[14px]
                  hover:bg-[#c49a3d] transition-colors"
              >
                Report a problem
              </a>
              <a
                href="mailto:safety@kiwimart.co.nz"
                className="inline-flex items-center justify-center h-11 px-7 rounded-full
                  border border-white/20 text-white font-semibold text-[14px]
                  hover:border-white/50 transition-colors"
              >
                Email safety@kiwimart.co.nz
              </a>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
