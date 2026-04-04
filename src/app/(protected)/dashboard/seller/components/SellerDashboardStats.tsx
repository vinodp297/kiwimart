"use client";

import { formatPrice } from "@/lib/utils";
import type { SellerStatsRow } from "@/server/actions/dashboard";

interface Props {
  stats: SellerStatsRow;
}

export default function SellerDashboardStats({ stats }: Props) {
  const kpis = [
    {
      icon: (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <line x1="12" y1="1" x2="12" y2="23" />
          <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
        </svg>
      ),
      value: formatPrice(stats.totalRevenue),
      label: "Total revenue",
      sub: "All time",
    },
    {
      icon: (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
          <line x1="3" y1="6" x2="21" y2="6" />
          <path d="M16 10a4 4 0 0 1-8 0" />
        </svg>
      ),
      value: stats.totalSales.toString(),
      label: "Items sold",
      sub: "All time",
    },
    {
      icon: (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      ),
      value: stats.avgRating.toFixed(1),
      label: "Avg rating",
      sub: `${stats.reviewCount} reviews`,
    },
    {
      icon: (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
      ),
      value: stats.activeListings.toString(),
      label: "Active listings",
      sub: `${stats.pendingOrders} orders pending`,
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {kpis.map(({ icon, value, label, sub }) => (
        <div
          key={label}
          className="bg-white rounded-2xl border border-[#E3E0D9] p-5
            hover:shadow-sm transition-shadow"
        >
          <div
            className="w-9 h-9 rounded-xl bg-[#F8F7F4] text-[#73706A]
              flex items-center justify-center mb-3"
          >
            {icon}
          </div>
          <p
            className="font-[family-name:var(--font-playfair)] text-[1.5rem]
              font-semibold text-[#141414] leading-none"
          >
            {value}
          </p>
          <p className="text-[12.5px] font-medium text-[#141414] mt-1">
            {label}
          </p>
          <p className="text-[11.5px] text-[#9E9A91] mt-0.5">{sub}</p>
        </div>
      ))}
    </div>
  );
}
