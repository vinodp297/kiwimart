"use client";
// src/app/(protected)/admin/disputes/[id]/components/CaseViewEvidence.tsx
// ─── Sections B (Buyer's Claim) + C (Seller's Response) + D (Counter-evidence)

import { useState } from "react";
import { Section } from "./case-view-shared";
import { REASON_LABELS, fmtDateTime, hoursSince } from "./case-view-types";
import type { DisputeData, EvidenceItem, CaseData } from "./case-view-types";

// ── Dispute Status Badge ───────────────────────────────────────────────────────

const DISPUTE_STATUS_COLORS: Record<string, string> = {
  OPEN: "bg-blue-50 text-blue-700 border-blue-200",
  AWAITING_SELLER_RESPONSE: "bg-amber-50 text-amber-700 border-amber-200",
  SELLER_RESPONDED: "bg-purple-50 text-purple-700 border-purple-200",
  UNDER_REVIEW: "bg-amber-50 text-amber-700 border-amber-200",
  AUTO_RESOLVING: "bg-amber-50 text-amber-700 border-amber-200",
  RESOLVED_BUYER: "bg-emerald-50 text-emerald-700 border-emerald-200",
  RESOLVED_SELLER: "bg-emerald-50 text-emerald-700 border-emerald-200",
  PARTIAL_RESOLUTION: "bg-emerald-50 text-emerald-700 border-emerald-200",
  CLOSED: "bg-gray-50 text-gray-600 border-gray-200",
};

const DISPUTE_STATUS_LABELS: Record<string, string> = {
  OPEN: "Open",
  AWAITING_SELLER_RESPONSE: "Awaiting seller",
  SELLER_RESPONDED: "Seller responded",
  UNDER_REVIEW: "Under review",
  AUTO_RESOLVING: "Auto-resolving",
  RESOLVED_BUYER: "Buyer won",
  RESOLVED_SELLER: "Seller won",
  PARTIAL_RESOLUTION: "Partial",
  CLOSED: "Closed",
};

function DisputeStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
        DISPUTE_STATUS_COLORS[status] ??
        "bg-gray-50 text-gray-600 border-gray-200"
      }`}
    >
      {DISPUTE_STATUS_LABELS[status] ?? status.replace(/_/g, " ")}
    </span>
  );
}

// ── Photo Grid with Lightbox ───────────────────────────────────────────────────

function PhotoGrid({ photos, label }: { photos: string[]; label: string }) {
  const [lightbox, setLightbox] = useState<string | null>(null);

  return (
    <>
      <p className="text-[10px] font-semibold text-[#9E9A91] uppercase tracking-wider mt-3 mb-1.5">
        {label} ({photos.length})
      </p>
      <div className="flex gap-2 flex-wrap">
        {photos.map((url, i) => (
          <button
            key={url}
            type="button"
            onClick={() => setLightbox(url)}
            className="w-20 h-20 rounded-lg overflow-hidden border border-[#E3E0D9]
              hover:ring-2 hover:ring-[#D4A843]/40 transition focus:outline-none"
          >
            <img
              src={url}
              alt={`${label} ${i + 1}`}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          </button>
        ))}
      </div>
      {lightbox && (
        <div
          className="fixed inset-0 z-[600] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 text-white/80 hover:text-white text-2xl w-10 h-10 flex items-center justify-center rounded-full bg-black/40"
          >
            &times;
          </button>
          <img
            src={lightbox}
            alt="Evidence photo"
            className="max-w-full max-h-[85vh] rounded-xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  dispute: DisputeData | null;
  buyerEvidence: EvidenceItem[];
  sellerEvidence: EvidenceItem[];
  interactions: CaseData["interactions"];
  counterEvidence: CaseData["counterEvidence"];
}

export default function CaseViewEvidence({
  dispute,
  buyerEvidence,
  sellerEvidence,
  interactions,
  counterEvidence,
}: Props) {
  return (
    <>
      {/* B: Buyer's Claim */}
      <Section title="The dispute — Buyer's claim">
        <div className="space-y-3">
          {dispute?.reason && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-block px-3 py-1 rounded-full text-[12px] font-semibold bg-red-50 text-red-700 border border-red-200">
                {REASON_LABELS[dispute.reason] ?? dispute.reason}
              </span>
              {dispute.source === "PICKUP_REJECTION" && (
                <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
                  Pickup rejection
                </span>
              )}
              <DisputeStatusBadge status={dispute.status} />
            </div>
          )}
          {dispute?.buyerStatement && (
            <p className="text-[13px] text-[#141414] leading-relaxed whitespace-pre-wrap">
              {dispute.buyerStatement}
            </p>
          )}
          <p className="text-[11px] text-[#9E9A91]">
            Filed: {fmtDateTime(dispute?.openedAt ?? null)}
          </p>

          {/* Buyer evidence photos */}
          {buyerEvidence.length > 0 && (
            <PhotoGrid
              photos={buyerEvidence.map((e) => e.url)}
              label="Buyer's evidence"
            />
          )}

          {/* Prior interactions */}
          {interactions.length > 0 && (
            <div className="mt-3 border-t border-[#F0EDE8] pt-3">
              <p className="text-[11px] font-semibold text-[#9E9A91] uppercase tracking-wider mb-2">
                Prior resolution attempts
              </p>
              {interactions.map((i) => (
                <div
                  key={i.id}
                  className="text-[12px] text-[#73706A] py-1 flex gap-2"
                >
                  <span className="font-medium text-[#141414]">
                    {i.type.replace(/_/g, " ")}
                  </span>
                  <span className="text-[#9E9A91]">
                    ({i.status.toLowerCase()})
                  </span>
                  {i.reason && (
                    <span className="text-[#73706A] truncate max-w-[300px]">
                      — {i.reason}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </Section>

      {/* C: Seller's Response */}
      <Section title="Seller's response">
        {dispute?.sellerStatement ? (
          <div className="space-y-2">
            <p className="text-[13px] text-[#141414] leading-relaxed whitespace-pre-wrap">
              {dispute.sellerStatement}
            </p>
            <p className="text-[11px] text-[#9E9A91]">
              Responded: {fmtDateTime(dispute.sellerRespondedAt)}
            </p>
            {/* Seller evidence photos */}
            {sellerEvidence.length > 0 && (
              <PhotoGrid
                photos={sellerEvidence.map((e) => e.url)}
                label="Seller's evidence"
              />
            )}
          </div>
        ) : (
          <div>
            <p
              className={`text-[13px] font-medium ${
                hoursSince(dispute?.openedAt ?? null) > 72
                  ? "text-red-600"
                  : "text-amber-600"
              }`}
            >
              Seller has not responded. {hoursSince(dispute?.openedAt ?? null)}h
              since dispute was filed.
            </p>
          </div>
        )}
      </Section>

      {/* D: Counter-evidence */}
      {counterEvidence.length > 0 && (
        <Section title="Counter-evidence (cooling period)">
          {counterEvidence.map((ce) => {
            const meta = ce.metadata ?? {};
            return (
              <div key={ce.id} className="space-y-2 py-2">
                <p className="text-[12px] text-[#73706A]">
                  <span className="font-semibold text-[#141414]">
                    {ce.actor?.displayName ?? ce.actorRole}
                  </span>{" "}
                  submitted counter-evidence on {fmtDateTime(ce.createdAt)}
                </p>
                {!!meta.description && (
                  <p className="text-[13px] text-[#141414] leading-relaxed">
                    {String(meta.description)}
                  </p>
                )}
                {Array.isArray(meta.evidenceKeys) &&
                  meta.evidenceKeys.length > 0 && (
                    <p className="text-[11px] text-[#9E9A91]">
                      {(meta.evidenceKeys as string[]).length} photo(s) attached
                    </p>
                  )}
              </div>
            );
          })}
        </Section>
      )}
    </>
  );
}
