"use client";
// src/components/RecentlyViewed.tsx
// ─── Recently Viewed Listings Section ─────────────────────────────────────────
// Authenticated users: fetches from DB. Guests: falls back to localStorage.

import { useState, useEffect } from "react";
import Link from "next/link";
import { useSessionSafe } from "@/hooks/useSessionSafe";
import { getRecentlyViewed } from "@/lib/recently-viewed";
import type { RecentlyViewedItem } from "@/lib/recently-viewed";
import { getRecentlyViewedFromDB } from "@/server/actions/recentlyViewed";
import { formatPrice, CONDITION_LABELS } from "@/lib/utils";
import type { Condition } from "@/types";

interface DisplayItem {
  id: string;
  title: string;
  price: number;
  thumbnailUrl: string;
  condition: string;
}

export default function RecentlyViewed({
  excludeId,
  maxItems = 8,
  title = "Recently viewed",
}: {
  excludeId?: string;
  maxItems?: number;
  title?: string;
}) {
  const { status } = useSessionSafe();
  const [items, setItems] = useState<DisplayItem[]>([]);

  useEffect(() => {
    async function load() {
      let loaded: DisplayItem[] = [];

      if (status === "authenticated") {
        // Fetch from DB
        const result = await getRecentlyViewedFromDB(maxItems + 1);
        if (result.success) {
          loaded = result.data.map((r) => ({
            id: r.id,
            title: r.title,
            price: r.price,
            thumbnailUrl: r.thumbnailUrl,
            condition: r.condition,
          }));
        }
      } else if (status === "unauthenticated") {
        // Fallback to localStorage for guests
        loaded = getRecentlyViewed().map((i) => ({
          id: i.id,
          title: i.title,
          price: i.price,
          thumbnailUrl: i.thumbnailUrl,
          condition: i.condition,
        }));
      }

      // Filter and limit
      const filtered = loaded
        .filter((i) => i.id !== excludeId)
        .slice(0, maxItems);
      setItems(filtered);
    }

    if (status !== "loading") {
      load();
    }
  }, [excludeId, maxItems, status]);

  if (items.length === 0) return null;

  return (
    <section className="mt-10 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2
          className="font-[family-name:var(--font-playfair)] text-[1.25rem]
          font-semibold text-[#141414]"
        >
          {title}
        </h2>
        <span className="text-[11.5px] text-[#9E9A91]">
          {items.length} item{items.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {items.map((item) => (
          <Link
            key={item.id}
            href={`/listings/${item.id}`}
            className="group bg-white rounded-2xl border border-[#E3E0D9] overflow-hidden
              hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
          >
            <div className="relative aspect-square bg-[#F8F7F4] overflow-hidden">
              <img
                src={item.thumbnailUrl}
                alt={item.title}
                className="w-full h-full object-cover transition-transform duration-300
                  group-hover:scale-105"
              />
            </div>
            <div className="p-3">
              <p className="text-[12.5px] font-medium text-[#141414] line-clamp-1">
                {item.title}
              </p>
              <p
                className="font-[family-name:var(--font-playfair)] text-[1rem]
                font-semibold text-[#141414] mt-0.5"
              >
                {formatPrice(item.price)}
              </p>
              {item.condition && (
                <span className="text-[10px] text-[#9E9A91] mt-0.5 block">
                  {CONDITION_LABELS[item.condition as Condition] ??
                    item.condition}
                </span>
              )}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
