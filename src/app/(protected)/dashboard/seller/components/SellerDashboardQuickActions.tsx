"use client";

import Link from "next/link";

interface Props {
  stripeOnboarded: boolean | null;
}

export default function SellerDashboardQuickActions({
  stripeOnboarded,
}: Props) {
  const cards = [
    // Stripe Connect setup card — show only if not onboarded
    ...(stripeOnboarded === false
      ? [
          {
            title: "Set up payouts",
            body: "Connect your Stripe account to receive payments when buyers purchase your listings.",
            cta: "Connect Stripe",
            href: "/account/stripe",
            colour: "border-[#D4A843]/40 bg-[#F5ECD4]/40",
          },
        ]
      : stripeOnboarded === true
        ? [
            {
              title: "Payouts active",
              body: "Your Stripe account is connected and ready to receive payments from buyers.",
              cta: "Manage payouts",
              href: "/account/stripe",
              colour: "border-emerald-200 bg-emerald-50/50",
            },
          ]
        : []),
    {
      title: "Complete your verification",
      body: "Verified sellers get 3x more views and build buyer trust faster.",
      cta: "Verify now",
      href: "/account/verify",
      colour: "border-[#D4A843]/40 bg-[#F5ECD4]/40",
    },
    {
      title: "Add more photos",
      body: "Listings with 5+ photos receive 60% more enquiries on average.",
      cta: "Edit listings",
      href: "#",
      colour: "border-sky-200 bg-sky-50/50",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {cards.map(({ title, body, cta, href, colour }) => (
        <div key={title} className={`rounded-2xl border p-4 ${colour}`}>
          <p className="text-[13px] font-semibold text-[#141414] mb-1">
            {title}
          </p>
          <p className="text-[12px] text-[#73706A] leading-relaxed mb-3">
            {body}
          </p>
          <Link
            href={href}
            className="text-[12px] font-semibold text-[#D4A843]
              hover:text-[#B8912E] transition-colors"
          >
            {cta} →
          </Link>
        </div>
      ))}
    </div>
  );
}
