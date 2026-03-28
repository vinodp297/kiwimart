"use client";
// src/components/PriceHistoryChart.tsx
// ─── Collapsible Price History Line Chart ────────────────────────────────────

import { useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

interface PricePoint {
  priceNzd: number; // cents
  changedAt: string; // ISO date
}

interface Props {
  history: PricePoint[];
  currentPriceNzd: number; // cents
}

export default function PriceHistoryChart({ history, currentPriceNzd }: Props) {
  const [open, setOpen] = useState(false);

  if (history.length < 2) return null;

  const data = history.map((p) => ({
    date: new Date(p.changedAt).toLocaleDateString("en-NZ", {
      day: "numeric",
      month: "short",
    }),
    price: p.priceNzd / 100,
  }));

  const minPrice = Math.min(...data.map((d) => d.price));
  const maxPrice = Math.max(...data.map((d) => d.price));
  const yMin = Math.floor(minPrice * 0.9);
  const yMax = Math.ceil(maxPrice * 1.1);

  const firstPrice = history[0]?.priceNzd ?? 0;
  const change = currentPriceNzd - firstPrice;
  const changePct =
    firstPrice > 0 ? Math.round((change / firstPrice) * 100) : 0;

  return (
    <section className="mt-4 bg-white rounded-2xl border border-[#E3E0D9] overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between p-5 text-left
          hover:bg-[#F8F7F4] transition-colors"
      >
        <div className="flex items-center gap-2">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#D4A843"
            strokeWidth="2"
          >
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
          <span className="font-[family-name:var(--font-playfair)] text-[1rem] font-semibold text-[#141414]">
            Price history
          </span>
          {changePct !== 0 && (
            <span
              className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                changePct < 0
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-red-50 text-red-600"
              }`}
            >
              {changePct > 0 ? "+" : ""}
              {changePct}%
            </span>
          )}
        </div>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#9E9A91"
          strokeWidth="2"
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="px-5 pb-5">
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EFEDE8" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: "#9E9A91" }}
                  tickLine={false}
                  axisLine={{ stroke: "#E3E0D9" }}
                />
                <YAxis
                  domain={[yMin, yMax]}
                  tick={{ fontSize: 11, fill: "#9E9A91" }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => `$${v}`}
                  width={50}
                />
                <Tooltip
                  formatter={(value) => [
                    `$${Number(value).toFixed(2)}`,
                    "Price",
                  ]}
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid #E3E0D9",
                    fontSize: 12,
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="price"
                  stroke="#D4A843"
                  strokeWidth={2}
                  dot={{ fill: "#D4A843", r: 3 }}
                  activeDot={{ r: 5, fill: "#D4A843" }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[11px] text-[#9E9A91] mt-2">
            {history.length} price {history.length === 1 ? "point" : "points"}{" "}
            recorded
          </p>
        </div>
      )}
    </section>
  );
}
