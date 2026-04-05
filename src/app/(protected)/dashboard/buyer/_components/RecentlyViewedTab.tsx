"use client";
// src/app/(protected)/dashboard/buyer/_components/RecentlyViewedTab.tsx

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/primitives";
import { formatPrice, formatCondition } from "@/lib/utils";
import {
  getRecentlyViewedFromDB,
  type RecentlyViewedRow,
} from "@/server/actions/recentlyViewed";

export function RecentlyViewedTab() {
  const [items, setItems] = useState<RecentlyViewedRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const result = await getRecentlyViewedFromDB(20);
      if (result.success) {
        setItems(result.data);
      }
      setLoading(false);
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="animate-pulse grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="bg-white rounded-2xl border border-[#E3E0D9] h-48"
          />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-dashed border-[#C9C5BC] p-12 text-center">
        <div className="w-14 h-14 rounded-full bg-[#F8F7F4] flex items-center justify-center mx-auto mb-4">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#9E9A91"
            strokeWidth="1.5"
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </div>
        <p className="text-[14px] text-[#9E9A91] mb-1">
          No recently viewed listings
        </p>
        <p className="text-[12px] text-[#C9C5BC]">
          Listings you view will appear here
        </p>
        <Link href="/search" className="mt-4 inline-block">
          <Button variant="secondary" size="sm">
            Browse listings
          </Button>
        </Link>
      </div>
    );
  }

  return (
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
            <p className="font-[family-name:var(--font-playfair)] text-[1rem] font-semibold text-[#141414] mt-0.5">
              {formatPrice(item.price)}
            </p>
            <span className="text-[10px] text-[#9E9A91] mt-0.5 block">
              {formatCondition(item.condition)}
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}
