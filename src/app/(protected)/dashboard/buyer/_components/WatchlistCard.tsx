"use client";
// src/app/(protected)/dashboard/buyer/_components/WatchlistCard.tsx

import { useState } from "react";
import Link from "next/link";
import { Button, ConditionBadge } from "@/components/ui/primitives";
import { formatPrice, relativeTime } from "@/lib/utils";
import type { Condition } from "@/types";
import type { WatchlistRow } from "@/server/actions/dashboard";
import { togglePriceAlert } from "@/server/actions/watchlist";

export function WatchlistCard({
  item,
  onRemove,
}: {
  item: WatchlistRow;
  onRemove: () => void;
}) {
  const isSold = item.status === "sold";
  const [alertEnabled, setAlertEnabled] = useState(item.isPriceAlertEnabled);
  const [alertLoading, setAlertLoading] = useState(false);

  async function handleToggleAlert() {
    const newState = !alertEnabled;
    setAlertEnabled(newState); // optimistic
    setAlertLoading(true);
    try {
      const result = await togglePriceAlert({
        listingId: item.id,
        enabled: newState,
      });
      if (!result.success) {
        setAlertEnabled(!newState); // revert
      }
    } catch {
      setAlertEnabled(!newState); // revert
    } finally {
      setAlertLoading(false);
    }
  }

  return (
    <article
      className="bg-white rounded-2xl border border-[#E3E0D9] overflow-hidden
      group hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
    >
      <Link href={`/listings/${item.id}`} className="block">
        <div className="relative aspect-video bg-[#F8F7F4] overflow-hidden">
          <img
            src={item.thumbnailUrl}
            alt={item.title}
            className="w-full h-full object-cover transition-transform duration-300
              group-hover:scale-105"
          />
          {isSold && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
              <span className="bg-white text-[#141414] text-[12px] font-bold px-3 py-1.5 rounded-full">
                SOLD
              </span>
            </div>
          )}
        </div>
      </Link>

      <div className="p-3.5">
        <Link
          href={`/listings/${item.id}`}
          className="text-[13px] font-semibold text-[#141414] hover:text-[#D4A843]
            transition-colors line-clamp-2 block"
        >
          {item.title}
        </Link>
        <p
          className="font-[family-name:var(--font-playfair)] text-[1.1rem] font-semibold
          text-[#141414] mt-1.5"
        >
          {formatPrice(item.price)}
        </p>
        <div className="flex items-center justify-between mt-2.5">
          <ConditionBadge condition={item.condition as Condition} />
          <span className="text-[10.5px] text-[#C9C5BC]">
            Watched {relativeTime(item.watchedAt)}
          </span>
        </div>

        {/* Price drop alert toggle */}
        {!isSold && (
          <button
            type="button"
            onClick={handleToggleAlert}
            disabled={alertLoading}
            className={`mt-2.5 w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl
              border text-[11.5px] font-medium transition-colors ${
                alertEnabled
                  ? "border-emerald-200 bg-emerald-50/60 text-emerald-700"
                  : "border-[#E3E0D9] bg-[#F8F7F4] text-[#9E9A91]"
              }`}
          >
            <span className="flex items-center gap-1.5">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill={alertEnabled ? "currentColor" : "none"}
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              Price drop alerts
            </span>
            <span
              className={`w-8 h-[18px] rounded-full relative transition-colors ${
                alertEnabled ? "bg-emerald-500" : "bg-[#C9C5BC]"
              }`}
            >
              <span
                className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform ${
                  alertEnabled ? "left-[15px]" : "left-0.5"
                }`}
              />
            </span>
          </button>
        )}

        <div className="flex gap-2 mt-3">
          <Link href={`/listings/${item.id}`} className="flex-1">
            <Button variant="secondary" size="sm" fullWidth>
              View
            </Button>
          </Link>
          <Button
            variant="ghost"
            size="sm"
            onClick={onRemove}
            aria-label="Remove from watchlist"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </Button>
        </div>
      </div>
    </article>
  );
}
