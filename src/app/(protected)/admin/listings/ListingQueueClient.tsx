"use client";
// src/app/(protected)/admin/listings/ListingQueueClient.tsx
// ─── Listing Moderation Queue Client Component ──────────────────────────────

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getImageUrl } from "@/lib/image";
import {
  approveListing,
  requestListingChanges,
  rejectListing,
} from "@/server/actions/admin-listing-moderation";

// ── Types ────────────────────────────────────────────────────────────────────

interface ListingRow {
  id: string;
  title: string;
  priceNzd: number;
  autoRiskScore: number | null;
  autoRiskFlags: string[];
  resubmissionCount?: number;
  createdAt: string;
  status: string;
  moderationNote?: string | null;
  moderatedAt?: string | null;
  seller: {
    id: string;
    displayName: string | null;
    email: string | null;
    phoneVerified: boolean | null;
    idVerified: boolean | null;
  };
  images: { r2Key: string; thumbnailKey: string | null }[];
}

interface Props {
  data: {
    pendingReview: ListingRow[];
    needsChanges: ListingRow[];
    stats: {
      pendingCount: number;
      needsChangesCount: number;
      approvedToday: number;
    };
  };
}

// ── Risk score colour ────────────────────────────────────────────────────────

function riskColour(score: number | null): string {
  if (score === null) return "bg-gray-100 text-gray-600";
  if (score >= 80) return "bg-red-100 text-red-700";
  if (score >= 50) return "bg-orange-100 text-orange-700";
  if (score >= 30) return "bg-yellow-100 text-yellow-700";
  return "bg-green-100 text-green-700";
}

function sellerVerificationBadge(seller: ListingRow["seller"]) {
  if (seller.idVerified)
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-green-700 bg-green-50 px-1.5 py-0.5 rounded-full">
        ID Verified
      </span>
    );
  if (seller.phoneVerified)
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded-full">
        Phone Verified
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-full">
      Basic
    </span>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export default function ListingQueueClient({ data }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<"pending" | "needs_changes">("pending");
  const [actionModal, setActionModal] = useState<{
    type: "approve" | "changes" | "reject";
    listingId: string;
    title: string;
  } | null>(null);
  const [note, setNote] = useState("");
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState("");

  const listings = tab === "pending" ? data.pendingReview : data.needsChanges;

  function openModal(
    type: "approve" | "changes" | "reject",
    listing: ListingRow,
  ) {
    setActionModal({ type, listingId: listing.id, title: listing.title });
    setNote("");
    setActionError("");
  }

  async function handleAction() {
    if (!actionModal) return;
    setActionError("");

    startTransition(async () => {
      let result;
      if (actionModal.type === "approve") {
        result = await approveListing(actionModal.listingId);
      } else if (actionModal.type === "changes") {
        if (!note.trim()) {
          setActionError(
            "Please provide a note explaining what needs to change.",
          );
          return;
        }
        result = await requestListingChanges(actionModal.listingId, note);
      } else {
        if (!note.trim()) {
          setActionError("Please provide a rejection reason.");
          return;
        }
        result = await rejectListing(actionModal.listingId, note);
      }

      if (!result.success) {
        setActionError(result.error ?? "Action failed.");
        return;
      }

      setActionModal(null);
      router.refresh();
    });
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="bg-[#141414] border-b border-white/10 px-6 py-5">
        <p className="text-[11px] text-white/40 uppercase tracking-wider mb-1">
          Admin
        </p>
        <h1 className="text-white text-xl font-semibold">Listing Queue</h1>
      </div>

      <div className="px-6 py-6">
        {/* Stats row */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-xl border border-[#E3E0D9] p-4">
            <p className="text-[11px] text-[#9E9A91] uppercase tracking-wider mb-1">
              Pending Review
            </p>
            <p className="text-2xl font-bold text-[#141414]">
              {data.stats.pendingCount}
            </p>
          </div>
          <div className="bg-white rounded-xl border border-[#E3E0D9] p-4">
            <p className="text-[11px] text-[#9E9A91] uppercase tracking-wider mb-1">
              Needs Changes
            </p>
            <p className="text-2xl font-bold text-[#141414]">
              {data.stats.needsChangesCount}
            </p>
          </div>
          <div className="bg-white rounded-xl border border-[#E3E0D9] p-4">
            <p className="text-[11px] text-[#9E9A91] uppercase tracking-wider mb-1">
              Approved Today
            </p>
            <p className="text-2xl font-bold text-green-600">
              {data.stats.approvedToday}
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-[#F5F4F0] rounded-lg p-1 mb-6 w-fit">
          <button
            onClick={() => setTab("pending")}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === "pending"
                ? "bg-white text-[#141414] shadow-sm"
                : "text-[#9E9A91] hover:text-[#141414]"
            }`}
          >
            Pending Review ({data.stats.pendingCount})
          </button>
          <button
            onClick={() => setTab("needs_changes")}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === "needs_changes"
                ? "bg-white text-[#141414] shadow-sm"
                : "text-[#9E9A91] hover:text-[#141414]"
            }`}
          >
            Needs Changes ({data.stats.needsChangesCount})
          </button>
        </div>

        {/* Listings table */}
        {listings.length === 0 ? (
          <div className="bg-white rounded-xl border border-[#E3E0D9] p-12 text-center">
            <p className="text-[#9E9A91] text-sm">
              {tab === "pending"
                ? "No listings pending review."
                : "No listings awaiting changes."}
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-[#E3E0D9] overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#F0EDE8]">
                  <th className="text-left text-[11px] text-[#9E9A91] uppercase tracking-wider font-medium px-4 py-3">
                    Listing
                  </th>
                  <th className="text-left text-[11px] text-[#9E9A91] uppercase tracking-wider font-medium px-4 py-3">
                    Seller
                  </th>
                  <th className="text-left text-[11px] text-[#9E9A91] uppercase tracking-wider font-medium px-4 py-3">
                    Price
                  </th>
                  <th className="text-left text-[11px] text-[#9E9A91] uppercase tracking-wider font-medium px-4 py-3">
                    Risk
                  </th>
                  <th className="text-left text-[11px] text-[#9E9A91] uppercase tracking-wider font-medium px-4 py-3">
                    Flags
                  </th>
                  <th className="text-right text-[11px] text-[#9E9A91] uppercase tracking-wider font-medium px-4 py-3">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {listings.map((listing) => (
                  <tr
                    key={listing.id}
                    className="border-b border-[#F0EDE8] last:border-0 hover:bg-[#FAFAF8] transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {listing.images[0] && (
                          <img
                            src={getImageUrl(
                              listing.images[0].thumbnailKey ??
                                listing.images[0].r2Key,
                            )}
                            alt=""
                            className="w-10 h-10 rounded-lg object-cover bg-[#F5F4F0]"
                          />
                        )}
                        <div>
                          <div className="flex items-center gap-1.5 flex-wrap max-w-[200px]">
                            <p className="text-sm font-medium text-[#141414] line-clamp-1">
                              {listing.title}
                            </p>
                            {listing.resubmissionCount != null &&
                              listing.resubmissionCount > 0 && (
                                <span className="inline-flex items-center text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full uppercase tracking-wide whitespace-nowrap">
                                  Resubmitted
                                </span>
                              )}
                          </div>
                          <p className="text-[11px] text-[#9E9A91]">
                            {new Date(listing.createdAt).toLocaleDateString(
                              "en-NZ",
                            )}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div>
                        <p className="text-sm text-[#141414]">
                          {listing.seller.displayName ?? "Unknown"}
                        </p>
                        {sellerVerificationBadge(listing.seller)}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-[#141414]">
                        ${(listing.priceNzd / 100).toFixed(2)}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${riskColour(listing.autoRiskScore)}`}
                      >
                        {listing.autoRiskScore ?? "N/A"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1 max-w-[200px]">
                        {listing.autoRiskFlags.slice(0, 3).map((flag) => (
                          <span
                            key={flag}
                            className="text-[10px] font-mono bg-[#F5F4F0] text-[#73706A] px-1.5 py-0.5 rounded"
                          >
                            {flag}
                          </span>
                        ))}
                        {listing.autoRiskFlags.length > 3 && (
                          <span className="text-[10px] text-[#9E9A91]">
                            +{listing.autoRiskFlags.length - 3}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openModal("approve", listing)}
                          className="text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 px-3 py-1.5 rounded-lg transition-colors"
                        >
                          Approve
                        </button>
                        {tab === "pending" && (
                          <button
                            onClick={() => openModal("changes", listing)}
                            className="text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 px-3 py-1.5 rounded-lg transition-colors"
                          >
                            Changes
                          </button>
                        )}
                        <button
                          onClick={() => openModal("reject", listing)}
                          className="text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-lg transition-colors"
                        >
                          Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Action Modal */}
      {actionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full mx-4 p-6">
            <h2 className="text-lg font-semibold text-[#141414] mb-1">
              {actionModal.type === "approve" && "Approve listing"}
              {actionModal.type === "changes" && "Request changes"}
              {actionModal.type === "reject" && "Reject listing"}
            </h2>
            <p className="text-sm text-[#73706A] mb-4">
              &quot;{actionModal.title}&quot;
            </p>

            {actionModal.type === "approve" ? (
              <p className="text-sm text-[#73706A] mb-4">
                This will publish the listing and notify the seller.
              </p>
            ) : (
              <div className="mb-4">
                <label className="block text-sm font-medium text-[#141414] mb-1.5">
                  {actionModal.type === "changes"
                    ? "What needs to change?"
                    : "Rejection reason"}
                </label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={
                    actionModal.type === "changes"
                      ? "Describe what the seller needs to fix..."
                      : "Explain why this listing is being rejected..."
                  }
                  className="w-full border border-[#E3E0D9] rounded-xl px-3 py-2 text-sm min-h-[100px] focus:outline-none focus:ring-2 focus:ring-[#D4A843]/30 focus:border-[#D4A843]"
                />
              </div>
            )}

            {actionError && (
              <p className="text-sm text-red-600 mb-4">{actionError}</p>
            )}

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setActionModal(null)}
                disabled={isPending}
                className="px-4 py-2 text-sm font-medium text-[#73706A] hover:text-[#141414] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAction}
                disabled={isPending}
                className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50 ${
                  actionModal.type === "approve"
                    ? "bg-green-600 hover:bg-green-700"
                    : actionModal.type === "changes"
                      ? "bg-amber-600 hover:bg-amber-700"
                      : "bg-red-600 hover:bg-red-700"
                }`}
              >
                {isPending
                  ? "Processing..."
                  : actionModal.type === "approve"
                    ? "Approve"
                    : actionModal.type === "changes"
                      ? "Request Changes"
                      : "Reject"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
