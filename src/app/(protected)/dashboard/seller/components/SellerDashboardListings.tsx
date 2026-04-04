"use client";

import Link from "next/link";
import { Button, ConditionBadge } from "@/components/ui/primitives";
import { formatPrice } from "@/lib/utils";
import type { SellerListingRow as SellerListingRowType } from "@/server/actions/dashboard";
import type { Condition } from "@/types";

interface Props {
  listings: SellerListingRowType[];
  deleteConfirm: string | null;
  actionLoading: string | null;
  onDeleteRequest: (id: string) => void;
  onDeleteCancel: () => void;
  onDeleteConfirm: (id: string) => void;
}

function SellerListingRow({
  listing,
  deleteConfirm,
  actionLoading,
  onDeleteRequest,
  onDeleteCancel,
  onDeleteConfirm,
}: {
  listing: SellerListingRowType;
  deleteConfirm: string | null;
  actionLoading: string | null;
  onDeleteRequest: () => void;
  onDeleteCancel: () => void;
  onDeleteConfirm: () => void;
}) {
  const isConfirming = deleteConfirm === listing.id;
  const isLoading = actionLoading === listing.id;
  const daysLeft = listing.expiresAt
    ? Math.max(
        0,
        Math.ceil(
          (new Date(listing.expiresAt).getTime() - Date.now()) / 86_400_000,
        ),
      )
    : null;

  return (
    <article
      className={`bg-white rounded-2xl border transition-all duration-200
        ${isConfirming ? "border-red-300 shadow-sm" : "border-[#E3E0D9]"}`}
    >
      <div className="p-4 flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <Link href={`/listings/${listing.id}`} className="shrink-0">
          <img
            src={listing.thumbnailUrl}
            alt={listing.title}
            className="w-16 h-16 rounded-xl object-cover border border-[#E3E0D9]"
          />
        </Link>

        <div className="flex-1 min-w-0">
          <Link
            href={`/listings/${listing.id}`}
            className="text-[13.5px] font-semibold text-[#141414] hover:text-[#D4A843]
              transition-colors line-clamp-1"
          >
            {listing.title}
          </Link>
          <div className="flex flex-wrap items-center gap-2.5 mt-1.5">
            {listing.status === "draft" && (
              <span className="text-[10px] font-bold text-orange-600 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded-full uppercase tracking-wide">
                Draft
              </span>
            )}
            {listing.status === "PENDING_REVIEW" && (
              <span className="text-[10px] font-bold text-blue-600 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full uppercase tracking-wide">
                Under Review
              </span>
            )}
            {listing.status === "NEEDS_CHANGES" && (
              <span className="text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full uppercase tracking-wide">
                Needs Changes
              </span>
            )}
            <ConditionBadge condition={listing.condition as Condition} />
            {listing.status !== "draft" &&
              listing.status !== "PENDING_REVIEW" &&
              listing.status !== "NEEDS_CHANGES" && (
                <>
                  <span className="text-[12px] text-[#9E9A91]">
                    {listing.viewCount.toLocaleString("en-NZ")} views
                  </span>
                  <span className="text-[12px] text-[#9E9A91]">
                    {listing.watcherCount} watchers
                  </span>
                  {listing.offerCount > 0 && (
                    <span className="text-[12px] text-amber-600 font-semibold">
                      {listing.offerCount} offer
                      {listing.offerCount > 1 ? "s" : ""}
                    </span>
                  )}
                  {daysLeft !== null && (
                    <span
                      className={`text-[11.5px] ${daysLeft <= 7 ? "text-red-500" : "text-[#9E9A91]"}`}
                    >
                      Expires in {daysLeft}d
                    </span>
                  )}
                </>
              )}
          </div>
        </div>

        <div className="flex items-center gap-4 shrink-0">
          <p className="font-[family-name:var(--font-playfair)] text-[1.2rem] font-semibold text-[#141414]">
            {formatPrice(listing.price)}
          </p>

          {!isConfirming ? (
            <div className="flex gap-2">
              <Link
                href={
                  listing.status === "draft"
                    ? `/sell?draft=${listing.id}`
                    : `/sell/edit/${listing.id}`
                }
              >
                <Button
                  variant={listing.status === "draft" ? "gold" : "secondary"}
                  size="sm"
                >
                  {listing.status === "draft" ? "Continue editing" : "Edit"}
                </Button>
              </Link>
              <Button variant="ghost" size="sm" onClick={onDeleteRequest}>
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6M14 11v6" />
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                </svg>
              </Button>
            </div>
          ) : (
            <div className="flex gap-2 items-center">
              <p className="text-[12px] text-red-600 font-medium">Delete?</p>
              <Button
                variant="danger"
                size="sm"
                loading={isLoading}
                onClick={onDeleteConfirm}
              >
                Yes, delete
              </Button>
              <Button variant="ghost" size="sm" onClick={onDeleteCancel}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

export default function SellerDashboardListings({
  listings,
  deleteConfirm,
  actionLoading,
  onDeleteRequest,
  onDeleteCancel,
  onDeleteConfirm,
}: Props) {
  return (
    <div role="tabpanel" aria-label="My Listings" className="space-y-3">
      {listings.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-[13px] text-[#9E9A91]">
            {listings.filter((l) => l.status === "active").length} active
            {listings.filter((l) => l.status === "draft").length > 0 &&
              ` · ${listings.filter((l) => l.status === "draft").length} draft${listings.filter((l) => l.status === "draft").length !== 1 ? "s" : ""}`}
          </p>
          <Link href="/sell">
            <Button variant="primary" size="sm">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              New listing
            </Button>
          </Link>
        </div>
      )}

      {listings.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-[#C9C5BC] p-12 text-center">
          <p className="text-[14px] text-[#9E9A91] mb-3">No active listings</p>
          <Link href="/sell">
            <Button variant="gold" size="sm">
              Create your first listing
            </Button>
          </Link>
        </div>
      ) : (
        listings.map((listing) => (
          <SellerListingRow
            key={listing.id}
            listing={listing}
            deleteConfirm={deleteConfirm}
            actionLoading={actionLoading}
            onDeleteRequest={() => onDeleteRequest(listing.id)}
            onDeleteCancel={onDeleteCancel}
            onDeleteConfirm={() => onDeleteConfirm(listing.id)}
          />
        ))
      )}
    </div>
  );
}
