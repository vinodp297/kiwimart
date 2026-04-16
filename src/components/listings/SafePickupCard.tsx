"use client";
// src/components/listings/SafePickupCard.tsx
// ─── Safe Pickup Spots Card — OI-007 ─────────────────────────────────────────
// Shown on listing detail pages when shippingOption === "pickup".
// Displays the seller's pickup address and suggests nearby public meeting spots.

import { useState } from "react";
import {
  getSpotsForRegion,
  buildMapsUrl,
  SPOT_TYPE_LABELS,
} from "@/lib/pickup-spots";

interface SafePickupCardProps {
  pickupAddress: string | null;
  region: string;
  suburb: string | null;
}

export function SafePickupCard({
  pickupAddress,
  region,
  suburb,
}: SafePickupCardProps) {
  const [expanded, setExpanded] = useState(false);

  const displayAddress =
    pickupAddress ?? (suburb ? `${suburb}, ${region}` : region);

  const spots = getSpotsForRegion(region);

  return (
    <div className="text-[12.5px] text-[#73706A]">
      {/* Pickup address row */}
      <span>Pickup only · {displayAddress}</span>

      {/* Safe spots toggle */}
      {spots.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1 text-[11.5px] text-emerald-600
              font-medium hover:underline focus:outline-none"
            aria-expanded={expanded}
          >
            <svg
              aria-hidden="true"
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            {expanded ? "Hide safe meeting spots" : "View safe meeting spots"}
          </button>

          {expanded && (
            <div className="mt-2 rounded-xl border border-[#E3E0D9] bg-[#FAFAF8] p-3 space-y-2">
              <p className="text-[11px] text-[#9E9A91] mb-2 leading-relaxed">
                For your safety, consider meeting the seller at a busy public
                location. These spots near{" "}
                <span className="font-medium text-[#73706A]">{region}</span> are
                recommended:
              </p>

              {spots.map((spot) => (
                <div
                  key={spot.id}
                  className="flex items-start justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="text-[12px] font-medium text-[#141414] truncate">
                      {spot.name}
                    </p>
                    <p className="text-[11px] text-[#9E9A91]">
                      {SPOT_TYPE_LABELS[spot.type]} · {spot.suburb}
                    </p>
                  </div>
                  <a
                    href={buildMapsUrl(spot.address)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-[11px] text-[#D4A843] font-medium
                      hover:underline whitespace-nowrap"
                    aria-label={`Directions to ${spot.name}`}
                  >
                    Directions →
                  </a>
                </div>
              ))}

              <p className="text-[10.5px] text-[#C9C5BC] pt-1 border-t border-[#E3E0D9] mt-2">
                Always bring a friend and meet in daylight hours.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default SafePickupCard;
