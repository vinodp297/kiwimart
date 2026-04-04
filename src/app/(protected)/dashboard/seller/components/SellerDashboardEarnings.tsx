"use client";

import { useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import {
  calculateSellerTierSync,
  TIER_REQUIREMENTS_DEFAULT,
  TIER_CONFIG,
} from "@/lib/seller-tiers";
import type { SellerOrderRow } from "@/server/actions/dashboard";

// ── Seller Insights Chart ──────────────────────────────────────────────────────

function SellerInsightsChart({ orders }: { orders: SellerOrderRow[] }) {
  const [view, setView] = useState<"revenue" | "sales">("revenue");

  const monthlyData = (() => {
    const months: { label: string; revenue: number; sales: number }[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        label: d.toLocaleDateString("en-NZ", {
          month: "short",
          year: "2-digit",
        }),
        revenue: 0,
        sales: 0,
      });
    }

    orders.forEach((o) => {
      if (o.status !== "completed") return;
      const d = new Date(o.createdAt);
      for (let i = 0; i < months.length; i++) {
        const now2 = new Date();
        const monthDate = new Date(
          now2.getFullYear(),
          now2.getMonth() - (5 - i),
          1,
        );
        const nextMonth = new Date(
          monthDate.getFullYear(),
          monthDate.getMonth() + 1,
          1,
        );
        if (d >= monthDate && d < nextMonth) {
          const bucket = months[i];
          if (bucket) {
            bucket.revenue += o.total;
            bucket.sales += 1;
          }
          break;
        }
      }
    });

    return months;
  })();

  const hasData = monthlyData.some((m) => m.revenue > 0 || m.sales > 0);
  if (!hasData) return null;

  return (
    <div className="bg-white rounded-2xl border border-[#E3E0D9] p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[13.5px] font-semibold text-[#141414]">
          Seller insights
        </h3>
        <div className="flex gap-1 bg-[#F8F7F4] rounded-lg p-0.5">
          {(["revenue", "sales"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`px-3 py-1 rounded-md text-[11px] font-medium transition-colors ${
                view === v
                  ? "bg-white text-[#141414] shadow-sm"
                  : "text-[#9E9A91] hover:text-[#73706A]"
              }`}
            >
              {v === "revenue" ? "Revenue" : "Sales"}
            </button>
          ))}
        </div>
      </div>
      <div className="h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={monthlyData}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#EFEDE8"
              vertical={false}
            />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: "#9E9A91" }}
              tickLine={false}
              axisLine={{ stroke: "#E3E0D9" }}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#9E9A91" }}
              tickLine={false}
              axisLine={false}
              width={50}
              tickFormatter={(v: number) =>
                view === "revenue" ? `$${v}` : `${v}`
              }
            />
            <Tooltip
              formatter={(value) => [
                view === "revenue"
                  ? `$${Number(value).toFixed(2)}`
                  : `${value} sale${Number(value) !== 1 ? "s" : ""}`,
                view === "revenue" ? "Revenue" : "Sales",
              ]}
              contentStyle={{
                borderRadius: 12,
                border: "1px solid #E3E0D9",
                fontSize: 12,
              }}
            />
            <Bar
              dataKey={view}
              fill="#D4A843"
              radius={[6, 6, 0, 0]}
              maxBarSize={40}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[11px] text-[#9E9A91] mt-2">Last 6 months</p>
    </div>
  );
}

// ── Tier Progress ──────────────────────────────────────────────────────────────

function TierProgress({
  completedSales,
  avgRating,
}: {
  completedSales: number;
  avgRating: number;
}) {
  const currentTier = calculateSellerTierSync({
    completedSales,
    avgRating,
    completionRate: 100,
  });

  const nextTierKey =
    currentTier === null
      ? "BRONZE"
      : currentTier === "BRONZE"
        ? "SILVER"
        : currentTier === "SILVER"
          ? "GOLD"
          : null;

  if (nextTierKey === null) {
    const cfg = TIER_CONFIG["GOLD"] ?? { icon: "", label: "", colour: "" };
    return (
      <div className="bg-white rounded-2xl border border-[#E3E0D9] p-5">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-lg">{cfg.icon}</span>
          <h3 className="text-[14px] font-semibold text-[#141414]">
            {cfg.label}
          </h3>
        </div>
        <p className="text-[12.5px] text-[#73706A]">
          You have reached the highest seller tier. Keep up the great work!
        </p>
      </div>
    );
  }

  const req = TIER_REQUIREMENTS_DEFAULT[nextTierKey] ?? { sales: 0, rating: 0 };
  const cfg = TIER_CONFIG[nextTierKey] ?? { icon: "", label: "", colour: "" };
  const salesPct = Math.min(
    100,
    Math.round((completedSales / req.sales) * 100),
  );
  const ratingPct = Math.min(100, Math.round((avgRating / req.rating) * 100));

  return (
    <div className="bg-white rounded-2xl border border-[#E3E0D9] p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">{cfg.icon}</span>
        <h3 className="text-[14px] font-semibold text-[#141414]">
          {currentTier ? `Next: ${cfg.label}` : `Unlock ${cfg.label}`}
        </h3>
      </div>
      <div className="space-y-3">
        <div>
          <div className="flex justify-between text-[12px] mb-1">
            <span className="text-[#73706A]">
              Sales ({completedSales}/{req.sales})
            </span>
            <span className="font-medium text-[#141414]">{salesPct}%</span>
          </div>
          <div className="h-2 rounded-full bg-[#F0EDE8] overflow-hidden">
            <div
              className="h-full rounded-full bg-[#D4A843] transition-all duration-500"
              style={{ width: `${salesPct}%` }}
            />
          </div>
        </div>
        <div>
          <div className="flex justify-between text-[12px] mb-1">
            <span className="text-[#73706A]">
              Rating ({avgRating.toFixed(1)}/{req.rating})
            </span>
            <span className="font-medium text-[#141414]">{ratingPct}%</span>
          </div>
          <div className="h-2 rounded-full bg-[#F0EDE8] overflow-hidden">
            <div
              className="h-full rounded-full bg-[#D4A843] transition-all duration-500"
              style={{ width: `${ratingPct}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Exported wrapper ───────────────────────────────────────────────────────────

interface Props {
  orders: SellerOrderRow[];
  completedSales: number;
  avgRating: number;
}

export default function SellerDashboardEarnings({
  orders,
  completedSales,
  avgRating,
}: Props) {
  return (
    <>
      <TierProgress completedSales={completedSales} avgRating={avgRating} />
      <SellerInsightsChart orders={orders} />
    </>
  );
}
