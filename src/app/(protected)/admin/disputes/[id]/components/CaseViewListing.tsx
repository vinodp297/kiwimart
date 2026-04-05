"use client";
// src/app/(protected)/admin/disputes/[id]/components/CaseViewListing.tsx
// ─── Listing Snapshot (immutable evidence) + Listing Comparison ──────────────

import { getImageUrl } from "@/lib/image";
import { Section } from "./case-view-shared";
import { CONDITION_LABELS, SHIPPING_LABELS } from "./case-view-types";
import type {
  ListingSnapshotData,
  SnapshotImage,
  SnapshotAttribute,
  DisputeData,
  EvidenceItem,
  CaseData,
} from "./case-view-types";

// ── Listing Snapshot Section ──────────────────────────────────────────────────
// Shows the immutable copy of the listing that was captured at purchase time.
// This is the evidence admin should use — the live listing may have been edited.

function ListingSnapshotSection({
  snapshot,
}: {
  snapshot: ListingSnapshotData | null;
}) {
  if (!snapshot) {
    return (
      <div className="bg-[#F8F7F4] rounded-2xl border border-[#E3E0D9] p-5">
        <h3 className="text-[13px] font-semibold text-[#141414] mb-2">
          Listing at time of purchase
        </h3>
        <p className="text-[12px] text-[#9E9A91] italic">
          No snapshot available — this order was placed before listing snapshots
          were introduced.
        </p>
      </div>
    );
  }

  const capturedDate = new Date(snapshot.capturedAt).toLocaleDateString(
    "en-NZ",
    {
      day: "numeric",
      month: "long",
      year: "numeric",
    },
  );

  // Safe-cast the JSON blobs — we control the write path in captureListingSnapshot
  const images = (snapshot.images as SnapshotImage[] | null) ?? [];
  const attributes = (snapshot.attributes as SnapshotAttribute[] | null) ?? [];

  return (
    <div className="bg-amber-50 rounded-2xl border border-amber-200 p-5">
      {/* Header */}
      <div className="flex items-start justify-between mb-1">
        <h3 className="text-[13px] font-semibold text-amber-900">
          Listing at time of purchase
        </h3>
        <span className="text-[10px] font-bold text-amber-700 bg-amber-100 border border-amber-300 px-2 py-0.5 rounded-full uppercase tracking-wide">
          Evidence
        </span>
      </div>
      <p className="text-[11px] text-amber-700 mb-4">
        Captured on {capturedDate}. This is what the buyer saw — unaffected by
        any edits made after purchase.
      </p>

      {/* Title + condition + price row */}
      <div className="flex items-start gap-3 flex-wrap mb-3">
        <p className="text-[14px] font-semibold text-[#141414] flex-1 min-w-0">
          {snapshot.title}
        </p>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-[10.5px] font-semibold text-amber-800 bg-amber-100 border border-amber-200 px-2 py-0.5 rounded-full">
            {CONDITION_LABELS[snapshot.condition] ?? snapshot.condition}
          </span>
          <span className="text-[13px] font-bold text-[#141414]">
            ${(snapshot.priceNzd / 100).toFixed(2)}
          </span>
        </div>
      </div>

      {/* Category + shipping row */}
      <div className="flex items-center gap-3 text-[11.5px] text-amber-800 mb-3 flex-wrap">
        <span>
          {snapshot.categoryName}
          {snapshot.subcategoryName ? ` › ${snapshot.subcategoryName}` : ""}
        </span>
        <span className="text-amber-400">·</span>
        <span>
          {SHIPPING_LABELS[snapshot.shippingOption] ?? snapshot.shippingOption}
        </span>
        {snapshot.shippingNzd > 0 && (
          <>
            <span className="text-amber-400">·</span>
            <span>Shipping: ${(snapshot.shippingNzd / 100).toFixed(2)}</span>
          </>
        )}
        {snapshot.isNegotiable && (
          <>
            <span className="text-amber-400">·</span>
            <span>Negotiable</span>
          </>
        )}
      </div>

      {/* Images — horizontal scroll row */}
      {images.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1 mb-3">
          {images.map((img, i) => (
            <div
              key={img.r2Key}
              className="w-20 h-20 flex-shrink-0 rounded-lg overflow-hidden border border-amber-200"
            >
              <img
                src={getImageUrl(img.thumbnailKey ?? img.r2Key)}
                alt={`Listing photo ${i + 1}`}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            </div>
          ))}
        </div>
      )}

      {/* Description */}
      <div className="max-h-40 overflow-y-auto rounded-lg bg-white border border-amber-200 p-3 mb-3">
        <p className="text-[12px] text-[#141414] leading-relaxed whitespace-pre-wrap">
          {snapshot.description}
        </p>
      </div>

      {/* Attributes */}
      {attributes.length > 0 && (
        <div className="space-y-1">
          {attributes.map((attr) => (
            <div
              key={`${attr.label}-${attr.order}`}
              className="flex gap-2 text-[11.5px]"
            >
              <span className="text-amber-700 font-medium min-w-[100px]">
                {attr.label}:
              </span>
              <span className="text-[#141414]">{attr.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  snapshot: ListingSnapshotData | null;
  listing: CaseData["listing"];
  isNotAsDescribed: boolean;
  dispute: DisputeData | null;
  buyerEvidence: EvidenceItem[];
}

export default function CaseViewListing({
  snapshot,
  listing,
  isNotAsDescribed,
  dispute,
  buyerEvidence,
}: Props) {
  return (
    <>
      {/* Listing Snapshot — immutable copy captured at order creation */}
      <ListingSnapshotSection snapshot={snapshot} />

      {/* Listing Comparison (for not as described) */}
      {isNotAsDescribed && (
        <Section title="Listing comparison">
          <div className="grid grid-cols-2 gap-4">
            {/* What was listed */}
            <div className="bg-[#F8F7F4] rounded-xl p-4 border border-[#E3E0D9]">
              <p className="text-[10px] font-semibold text-[#9E9A91] uppercase tracking-wider mb-2">
                Current listing (may differ)
              </p>
              <p className="text-[13px] font-semibold text-[#141414]">
                {listing.title}
              </p>
              {listing.condition && (
                <p className="text-[11.5px] text-[#73706A] mt-1">
                  Condition:{" "}
                  {CONDITION_LABELS[listing.condition] ?? listing.condition}
                </p>
              )}
              <p className="text-[12px] text-[#73706A] mt-2 line-clamp-4">
                {listing.description}
              </p>
              {listing.images.length > 0 && (
                <div className="mt-3 flex gap-2">
                  {listing.images.slice(0, 3).map((img, i) => (
                    <div
                      key={img.r2Key}
                      className="w-16 h-16 rounded-lg overflow-hidden border border-[#E3E0D9]"
                    >
                      <img
                        src={getImageUrl(img.thumbnailKey ?? img.r2Key)}
                        alt={`Listing photo ${i + 1}`}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* What buyer received */}
            <div className="bg-red-50 rounded-xl p-4 border border-red-200">
              <p className="text-[10px] font-semibold text-red-500 uppercase tracking-wider mb-2">
                What buyer received
              </p>
              {dispute?.buyerStatement && (
                <p className="text-[12px] text-red-800 line-clamp-4">
                  {dispute.buyerStatement}
                </p>
              )}
              {buyerEvidence.length > 0 && (
                <div className="mt-3 flex gap-2">
                  {buyerEvidence.slice(0, 3).map((e, i) => (
                    <div
                      key={e.id}
                      className="w-16 h-16 rounded-lg overflow-hidden border border-red-200"
                    >
                      <img
                        src={e.url}
                        alt={`Evidence ${i + 1}`}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Section>
      )}
    </>
  );
}
