"use client";
// src/app/(protected)/seller/onboarding/_components/CurrentTierCard.tsx

import Link from "next/link";
import type { SellerTier, SellerTierName } from "@/lib/seller-tiers";

export function CurrentTierCard({
  currentTierName,
  tiers,
}: {
  currentTierName: SellerTierName;
  tiers: SellerTier[];
}) {
  return (
    <div className="bg-white rounded-2xl border border-[#E3E0D9] p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[11px] text-[#9E9A91] font-medium uppercase tracking-wide mb-1">
            Your Current Tier
          </p>
          <h2 className="font-[family-name:var(--font-playfair)] text-[1.5rem] font-semibold text-[#141414]">
            {tiers.find((t) => t.name === currentTierName)?.label}
          </h2>
          <p className="text-[13px] text-[#73706A] mt-1">
            {tiers.find((t) => t.name === currentTierName)?.description}
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
        {tiers
          .find((t) => t.name === currentTierName)
          ?.perks.map((perk) => (
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
  );
}

export function StripeCta({
  isStripeOnboarded,
}: {
  isStripeOnboarded: boolean;
}) {
  if (isStripeOnboarded) return null;
  return (
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
  );
}
