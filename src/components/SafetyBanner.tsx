// src/components/SafetyBanner.tsx
// ─── Safety Banner Component ─────────────────────────────────────────────────
// Displays safety tips on relevant pages (listing detail, checkout, etc.)

import Link from 'next/link';

interface Props {
  variant?: 'default' | 'compact';
}

export default function SafetyBanner({ variant = 'default' }: Props) {
  if (variant === 'compact') {
    return (
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#F5ECD4]
          border border-[#D4A843]/30 text-[11.5px] text-[#8B6914]"
      >
        <svg
          aria-hidden
          className="shrink-0 text-[#B8912E]"
          width="12" height="12" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2"
        >
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
        Protected by KiwiMart Buyer Guarantee.{' '}
        <Link href="/trust" className="underline hover:text-[#141414]">Learn more</Link>
      </div>
    );
  }

  return (
    <div
      className="flex items-start gap-3 px-4 py-3.5 rounded-xl
        bg-[#F5ECD4] border border-[#D4A843]/30"
    >
      <svg
        aria-hidden
        className="shrink-0 mt-0.5 text-[#B8912E]"
        width="15" height="15" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2"
      >
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
      <p className="text-[12px] text-[#8B6914] leading-relaxed">
        <strong>Stay safe:</strong> Always use KiwiMart&apos;s secure payment to keep
        your purchase covered by $3,000 buyer protection. Never pay by bank transfer
        outside the platform.{' '}
        <Link href="/safety" className="underline hover:text-[#141414] transition-colors">
          Safety guide
        </Link>
        {' · '}
        <Link href="/trust" className="underline hover:text-[#141414] transition-colors">
          Trust &amp; protection
        </Link>
      </p>
    </div>
  );
}
