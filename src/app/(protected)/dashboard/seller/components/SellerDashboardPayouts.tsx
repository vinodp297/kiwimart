"use client";

import Link from "next/link";
import { Alert } from "@/components/ui/primitives";
import { formatPrice } from "@/lib/utils";
import type {
  SellerPayoutRow,
  SellerStatsRow,
} from "@/server/actions/dashboard";

function PayoutRowCard({ payout }: { payout: SellerPayoutRow }) {
  const statusStyles: Record<string, string> = {
    pending: "bg-amber-50 text-amber-700 ring-amber-200",
    paid: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    failed: "bg-red-50 text-red-600 ring-red-200",
  };

  return (
    <div
      className="grid grid-cols-[1fr_auto_auto_auto] gap-4 px-5 py-4
        border-b border-[#F8F7F4] last:border-b-0 items-center"
    >
      <p className="text-[13px] text-[#141414] line-clamp-1">
        {payout.listingTitle}
      </p>
      <p className="text-[13px] font-semibold text-[#141414]">
        {formatPrice(payout.amount)}
      </p>
      <span
        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px]
          font-semibold ring-1 ${statusStyles[payout.status] ?? statusStyles.pending}`}
      >
        {payout.status.charAt(0).toUpperCase() + payout.status.slice(1)}
      </span>
      <p className="text-[12px] text-[#9E9A91] whitespace-nowrap">
        {payout.paidAt
          ? new Date(payout.paidAt).toLocaleDateString("en-NZ", {
              day: "numeric",
              month: "short",
            })
          : payout.estimatedArrival
            ? `Est. ${new Date(payout.estimatedArrival).toLocaleDateString("en-NZ", { day: "numeric", month: "short" })}`
            : "\u2014"}
      </p>
    </div>
  );
}

interface Props {
  payouts: SellerPayoutRow[];
  stats: SellerStatsRow;
}

export default function SellerDashboardPayouts({ payouts, stats }: Props) {
  const thisMonthPaid = payouts
    .filter(
      (p) =>
        p.status === "paid" &&
        p.paidAt &&
        new Date(p.paidAt).getMonth() === new Date().getMonth() &&
        new Date(p.paidAt).getFullYear() === new Date().getFullYear(),
    )
    .reduce((s, p) => s + p.amount, 0);

  const totalPaidOut = payouts
    .filter((p) => p.status === "paid")
    .reduce((s, p) => s + p.amount, 0);

  const summaryCards = [
    {
      value: formatPrice(stats.pendingPayout),
      label: "Pending payout",
      colour: "text-[#D4A843]",
    },
    {
      value: formatPrice(thisMonthPaid),
      label: "Earned this month",
      colour: "text-sky-600",
    },
    {
      value: formatPrice(totalPaidOut),
      label: "Total paid out",
      colour: "text-emerald-600",
    },
    {
      value: formatPrice(stats.totalRevenue),
      label: "Lifetime earnings",
      colour: "text-[#141414]",
    },
  ];

  return (
    <div role="tabpanel" aria-label="Payouts" className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {summaryCards.map(({ value, label, colour }) => (
          <div
            key={label}
            className="bg-white rounded-2xl border border-[#E3E0D9] p-5"
          >
            <p
              className={`font-[family-name:var(--font-playfair)] text-[1.75rem]
                font-semibold leading-none ${colour}`}
            >
              {value}
            </p>
            <p className="text-[12.5px] text-[#9E9A91] mt-1.5">{label}</p>
          </div>
        ))}
      </div>

      <Alert variant="info">
        Payouts are released 3 business days after the buyer confirms delivery.
        Funds arrive in your linked NZ bank account via Stripe.
      </Alert>

      <div className="bg-white rounded-2xl border border-[#E3E0D9] overflow-hidden">
        <div
          className="grid grid-cols-[1fr_auto_auto_auto] gap-4 px-5 py-3
            border-b border-[#F0EDE8] text-[11px] font-semibold text-[#9E9A91]
            uppercase tracking-wide"
        >
          <span>Item</span>
          <span>Amount</span>
          <span>Status</span>
          <span>Date</span>
        </div>
        {payouts.map((payout) => (
          <PayoutRowCard key={payout.id} payout={payout} />
        ))}
      </div>

      <div className="text-center">
        <p className="text-[12px] text-[#9E9A91]">
          Payouts processed via{" "}
          <strong className="text-[#141414]">Stripe Connect</strong>. Need help?{" "}
          <Link
            href="/support"
            className="text-[#D4A843] hover:text-[#B8912E] transition-colors"
          >
            Contact support
          </Link>
        </p>
      </div>
    </div>
  );
}
