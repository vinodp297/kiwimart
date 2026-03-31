"use client";
// src/app/(protected)/admin/disputes/[id]/CaseView.tsx
// ─── Single-Screen Case View ─────────────────────────────────────────────

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { getImageUrl } from "@/lib/image";
import { formatPrice } from "@/lib/utils";
import OrderTimeline from "@/components/OrderTimeline";
import {
  resolveDispute,
  resolveDisputePartialRefund,
  overrideAutoResolution,
  requestMoreInfo,
  flagUserForFraud,
} from "@/server/actions/admin";

// ── Types ─────────────────────────────────────────────────────────────────

interface AutoResolution {
  decision: string;
  score: number;
  recommendation: string;
  status: string;
  executeAt: string | null;
  factors: Array<{ factor: string; points: number; description: string }>;
}

interface Inconsistency {
  type: "warning" | "alert";
  message: string;
  severity: "low" | "medium" | "high";
}

interface TimelineEvent {
  id: string;
  type: string;
  actorRole: string;
  summary: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  actor: { displayName: string | null; username: string } | null;
}

interface CaseData {
  order: {
    id: string;
    totalNzd: number;
    status: string;
    createdAt: string;
    dispatchedAt: string | null;
    completedAt: string | null;
    trackingNumber: string | null;
    stripePaymentIntentId: string | null;
    disputeReason: string | null;
    disputeNotes: string | null;
    disputeOpenedAt: string | null;
    disputeEvidenceUrls: string[];
    sellerResponse: string | null;
    sellerRespondedAt: string | null;
    disputeResolvedAt: string | null;
  };
  listing: {
    id: string;
    title: string;
    description: string;
    condition: string | null;
    priceNzd: number;
    images: { r2Key: string; thumbnailKey: string | null }[];
  };
  buyer: {
    id: string;
    email: string;
    displayName: string;
    createdAt: string;
    metrics: {
      totalOrders: number;
      completedOrders: number;
      disputeCount: number;
      disputeRate: number;
      disputesLast30Days: number;
      accountAgeDays: number;
      isFlaggedForFraud: boolean;
    };
  };
  seller: {
    id: string;
    email: string;
    displayName: string;
    idVerified: boolean;
    createdAt: string;
    metrics: {
      totalOrders: number;
      completedOrders: number;
      disputeCount: number;
      disputeRate: number;
      averageResponseHours: number | null;
      averageRating: number | null;
      dispatchPhotoRate: number;
      accountAgeDays: number;
      isFlaggedForFraud: boolean;
    };
  };
  timeline: TimelineEvent[];
  interactions: Array<{
    id: string;
    type: string;
    status: string;
    reason: string | null;
    responseNote: string | null;
    createdAt: string;
    expiresAt: string | null;
    initiatedBy: { displayName: string } | null;
    responseBy: { displayName: string } | null;
  }>;
  messages: Array<{
    id: string;
    content: string;
    createdAt: string;
    sender: { displayName: string };
  }>;
  autoResolution: AutoResolution | null;
  inconsistencies: Inconsistency[];
  counterEvidence: Array<{
    id: string;
    actorRole: string;
    summary: string;
    metadata: Record<string, unknown> | null;
    createdAt: string;
    actor: { displayName: string | null } | null;
  }>;
  evidenceSignedUrls: string[];
}

interface Props {
  data: CaseData;
}

// ── Helpers ──────────────────────────────────────────────────────────────

const REASON_LABELS: Record<string, string> = {
  ITEM_NOT_RECEIVED: "Item not received",
  ITEM_NOT_AS_DESCRIBED: "Item not as described",
  ITEM_DAMAGED: "Item damaged",
  WRONG_ITEM_SENT: "Wrong item sent",
  COUNTERFEIT_ITEM: "Counterfeit item",
  SELLER_UNRESPONSIVE: "Seller unresponsive",
  SELLER_CANCELLED: "Seller cancelled",
  REFUND_NOT_PROCESSED: "Refund not processed",
  OTHER: "Other",
};

const SOP: Record<string, string> = {
  ITEM_NOT_RECEIVED:
    "Check tracking status. If tracking shows delivered, dismiss. If no tracking or no movement, refund buyer.",
  ITEM_NOT_AS_DESCRIBED:
    "Compare buyer's photos/description with original listing. If listing is materially misleading, refund buyer. If minor discrepancy, consider partial refund.",
  ITEM_DAMAGED:
    "Compare buyer's photos with seller's dispatch photos (if available). If damage is clear and not present in dispatch photos, refund buyer. If both have photos, consider partial refund.",
  WRONG_ITEM_SENT:
    "Check tracking and dispatch photos. If the wrong item was clearly sent, refund buyer.",
  OTHER:
    "Change of mind is not covered under buyer protection for private sellers. Direct buyer to return request flow. Under NZ Consumer Guarantees Act, private sellers are not obligated to accept change-of-mind returns.",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-NZ", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-NZ", { day: "numeric", month: "short" })}, ${d.toLocaleTimeString("en-NZ", { hour: "numeric", minute: "2-digit", hour12: true }).toLowerCase()}`;
}

function hoursSince(iso: string | null): number {
  if (!iso) return 0;
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60));
}

// ── Component ────────────────────────────────────────────────────────────

export default function CaseView({ data }: Props) {
  const { order, listing, buyer, seller, autoResolution, inconsistencies } =
    data;
  const router = useRouter();

  const isResolved = !!order.disputeResolvedAt;
  const isNotAsDescribed =
    order.disputeReason === "ITEM_NOT_AS_DESCRIBED" ||
    order.disputeReason === "ITEM_DAMAGED";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      {/* ── LEFT COLUMN (60%) — The Story ──────────────────────────── */}
      <div className="lg:col-span-3 space-y-6">
        {/* A: Order Timeline */}
        <OrderTimeline events={data.timeline} currentStatus={order.status} />

        {/* B: Buyer's Claim */}
        <Section title="The dispute — Buyer's claim">
          <div className="space-y-3">
            {order.disputeReason && (
              <span className="inline-block px-3 py-1 rounded-full text-[12px] font-semibold bg-red-50 text-red-700 border border-red-200">
                {REASON_LABELS[order.disputeReason] ?? order.disputeReason}
              </span>
            )}
            {order.disputeNotes && (
              <p className="text-[13px] text-[#141414] leading-relaxed whitespace-pre-wrap">
                {order.disputeNotes}
              </p>
            )}
            <p className="text-[11px] text-[#9E9A91]">
              Filed: {fmtDateTime(order.disputeOpenedAt)}
            </p>

            {/* Buyer evidence photos */}
            {data.evidenceSignedUrls.length > 0 && (
              <PhotoGrid
                photos={data.evidenceSignedUrls}
                label="Buyer's evidence"
              />
            )}

            {/* Prior interactions */}
            {data.interactions.length > 0 && (
              <div className="mt-3 border-t border-[#F0EDE8] pt-3">
                <p className="text-[11px] font-semibold text-[#9E9A91] uppercase tracking-wider mb-2">
                  Prior resolution attempts
                </p>
                {data.interactions.map((i) => (
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
          {order.sellerResponse ? (
            <div className="space-y-2">
              <p className="text-[13px] text-[#141414] leading-relaxed whitespace-pre-wrap">
                {order.sellerResponse}
              </p>
              <p className="text-[11px] text-[#9E9A91]">
                Responded: {fmtDateTime(order.sellerRespondedAt)}
              </p>
            </div>
          ) : (
            <div>
              <p
                className={`text-[13px] font-medium ${
                  hoursSince(order.disputeOpenedAt) > 72
                    ? "text-red-600"
                    : "text-amber-600"
                }`}
              >
                Seller has not responded. {hoursSince(order.disputeOpenedAt)}h
                since dispute was filed.
              </p>
            </div>
          )}
        </Section>

        {/* D: Counter-evidence */}
        {data.counterEvidence.length > 0 && (
          <Section title="Counter-evidence (cooling period)">
            {data.counterEvidence.map((ce) => {
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
                        {(meta.evidenceKeys as string[]).length} photo(s)
                        attached
                      </p>
                    )}
                </div>
              );
            })}
          </Section>
        )}

        {/* E: Message history */}
        {data.messages.length > 0 && (
          <Section title="Message history between buyer and seller">
            <div className="max-h-[300px] overflow-y-auto space-y-2 pr-2">
              {data.messages.map((m) => (
                <div key={m.id} className="py-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-semibold text-[#141414]">
                      {m.sender.displayName}
                    </span>
                    <span className="text-[10.5px] text-[#9E9A91]">
                      {fmtDateTime(m.createdAt)}
                    </span>
                  </div>
                  <p className="text-[12.5px] text-[#73706A] leading-relaxed mt-0.5">
                    {m.content}
                  </p>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Listing Comparison (for not as described) */}
        {isNotAsDescribed && (
          <Section title="Listing comparison">
            <div className="grid grid-cols-2 gap-4">
              {/* What was listed */}
              <div className="bg-[#F8F7F4] rounded-xl p-4 border border-[#E3E0D9]">
                <p className="text-[10px] font-semibold text-[#9E9A91] uppercase tracking-wider mb-2">
                  What was listed
                </p>
                <p className="text-[13px] font-semibold text-[#141414]">
                  {listing.title}
                </p>
                {listing.condition && (
                  <p className="text-[11.5px] text-[#73706A] mt-1">
                    Condition: {listing.condition}
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
                {order.disputeNotes && (
                  <p className="text-[12px] text-red-800 line-clamp-4">
                    {order.disputeNotes}
                  </p>
                )}
                {data.evidenceSignedUrls.length > 0 && (
                  <div className="mt-3 flex gap-2">
                    {data.evidenceSignedUrls.slice(0, 3).map((url, i) => (
                      <div
                        key={url}
                        className="w-16 h-16 rounded-lg overflow-hidden border border-red-200"
                      >
                        <img
                          src={url}
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
      </div>

      {/* ── RIGHT COLUMN (40%) — Decision Tools ───────────────────── */}
      <div className="lg:col-span-2 space-y-6">
        {/* F: System Analysis */}
        {autoResolution && (
          <Section title="System analysis">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-[#9E9A91] font-medium">
                  Score:
                </span>
                <span
                  className={`text-[1.5rem] font-bold font-[family-name:var(--font-playfair)] ${
                    autoResolution.score > 0
                      ? "text-emerald-700"
                      : autoResolution.score < 0
                        ? "text-red-700"
                        : "text-[#73706A]"
                  }`}
                >
                  {autoResolution.score >= 0 ? "+" : ""}
                  {autoResolution.score}
                </span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                    autoResolution.decision === "AUTO_REFUND"
                      ? "bg-emerald-50 text-emerald-700"
                      : autoResolution.decision === "AUTO_DISMISS"
                        ? "bg-sky-50 text-sky-700"
                        : autoResolution.decision === "FLAG_FRAUD"
                          ? "bg-red-50 text-red-700"
                          : "bg-amber-50 text-amber-700"
                  }`}
                >
                  {autoResolution.decision.replace(/_/g, " ")}
                </span>
              </div>

              {/* Factors */}
              <div className="space-y-1.5">
                {autoResolution.factors.map((f, i) => (
                  <div key={i} className="flex items-start gap-2 text-[12px]">
                    <span
                      className={`font-mono font-bold w-[40px] text-right flex-shrink-0 ${
                        f.points > 0
                          ? "text-emerald-600"
                          : f.points < 0
                            ? "text-red-600"
                            : "text-[#9E9A91]"
                      }`}
                    >
                      {f.points > 0 ? "+" : ""}
                      {f.points}
                    </span>
                    <span className="text-[#73706A]">{f.description}</span>
                  </div>
                ))}
              </div>

              {/* Recommendation */}
              <div className="bg-[#F8F7F4] rounded-lg p-3 border border-[#E3E0D9]">
                <p className="text-[12px] text-[#73706A] leading-relaxed">
                  {autoResolution.recommendation}
                </p>
              </div>
            </div>
          </Section>
        )}

        {/* G: Lie Detection */}
        {inconsistencies.length > 0 && (
          <Section title="Inconsistency alerts">
            <div className="space-y-2">
              {inconsistencies.map((alert, i) => (
                <div
                  key={i}
                  className={`rounded-lg p-3 border text-[12px] leading-relaxed ${
                    alert.severity === "high"
                      ? "bg-red-50 border-red-200 text-red-800"
                      : alert.severity === "medium"
                        ? "bg-amber-50 border-amber-200 text-amber-800"
                        : "bg-[#F8F7F4] border-[#E3E0D9] text-[#73706A]"
                  }`}
                >
                  <span className="font-semibold">
                    {alert.severity === "high"
                      ? "🚨 "
                      : alert.severity === "medium"
                        ? "⚠️ "
                        : "ℹ️ "}
                  </span>
                  {alert.message}
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* H: Buyer & Seller Profiles */}
        <Section title="Trust profiles">
          <div className="grid grid-cols-2 gap-3">
            <ProfileCard
              label="Buyer"
              name={buyer.displayName}
              email={buyer.email}
              memberSince={fmtDate(buyer.createdAt)}
              stats={[
                { label: "Orders", value: buyer.metrics.totalOrders },
                { label: "Disputes", value: buyer.metrics.disputeCount },
                {
                  label: "Rate",
                  value: `${buyer.metrics.disputeRate}%`,
                  alert: buyer.metrics.disputeRate > 15,
                },
                {
                  label: "Last 30d",
                  value: buyer.metrics.disputesLast30Days,
                  alert: buyer.metrics.disputesLast30Days > 3,
                },
              ]}
              isFlagged={buyer.metrics.isFlaggedForFraud}
            />
            <ProfileCard
              label="Seller"
              name={seller.displayName}
              email={seller.email}
              memberSince={fmtDate(seller.createdAt)}
              idVerified={seller.idVerified}
              stats={[
                { label: "Sales", value: seller.metrics.totalOrders },
                { label: "Disputes", value: seller.metrics.disputeCount },
                {
                  label: "Rate",
                  value: `${seller.metrics.disputeRate}%`,
                  alert: seller.metrics.disputeRate > 15,
                },
                {
                  label: "Rating",
                  value: seller.metrics.averageRating
                    ? `${seller.metrics.averageRating}/5`
                    : "—",
                },
                {
                  label: "Avg response",
                  value: seller.metrics.averageResponseHours
                    ? `${Math.round(seller.metrics.averageResponseHours)}h`
                    : "—",
                },
                {
                  label: "Photo rate",
                  value: `${seller.metrics.dispatchPhotoRate}%`,
                },
              ]}
              isFlagged={seller.metrics.isFlaggedForFraud}
            />
          </div>
        </Section>

        {/* I: Resolution Actions + SOP */}
        <Section title="Resolution">
          {/* SOP Guidance */}
          {order.disputeReason && SOP[order.disputeReason] && (
            <div className="bg-sky-50 rounded-lg p-3 border border-sky-200 mb-4">
              <p className="text-[10px] font-semibold text-sky-600 uppercase tracking-wider mb-1">
                Standard procedure
              </p>
              <p className="text-[12px] text-sky-800 leading-relaxed">
                {SOP[order.disputeReason]}
              </p>
            </div>
          )}

          {isResolved ? (
            <div className="bg-emerald-50 rounded-lg p-3 border border-emerald-200 text-center">
              <p className="text-[13px] font-semibold text-emerald-700">
                This dispute has been resolved
              </p>
              <p className="text-[11px] text-emerald-600 mt-1">
                Resolved: {fmtDate(order.disputeResolvedAt)}
              </p>
            </div>
          ) : (
            <ResolutionActions
              orderId={order.id}
              totalNzd={order.totalNzd}
              buyerId={buyer.id}
              sellerId={seller.id}
              autoResolution={autoResolution}
              onResolved={() => router.refresh()}
            />
          )}
        </Section>
      </div>
    </div>
  );
}

// ── Section Wrapper ──────────────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-[#E3E0D9] p-5">
      <h3 className="text-[13px] font-semibold text-[#141414] mb-3">{title}</h3>
      {children}
    </div>
  );
}

// ── Photo Grid with Lightbox ─────────────────────────────────────────────

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

// ── Profile Card ─────────────────────────────────────────────────────────

function ProfileCard({
  label,
  name,
  email,
  memberSince,
  idVerified,
  stats,
  isFlagged,
}: {
  label: string;
  name: string;
  email: string;
  memberSince: string;
  idVerified?: boolean;
  stats: Array<{ label: string; value: string | number; alert?: boolean }>;
  isFlagged: boolean;
}) {
  return (
    <div
      className={`rounded-xl p-3 border ${
        isFlagged ? "bg-red-50 border-red-200" : "bg-[#F8F7F4] border-[#E3E0D9]"
      }`}
    >
      <p className="text-[10px] font-semibold text-[#9E9A91] uppercase tracking-wider mb-1.5">
        {label}
        {isFlagged && (
          <span className="ml-1.5 text-red-600">🚩 Fraud flagged</span>
        )}
      </p>
      <p className="text-[13px] font-semibold text-[#141414] truncate">
        {name}
        {idVerified && (
          <span className="ml-1 text-emerald-600 text-[10px]">✓ ID</span>
        )}
      </p>
      <p className="text-[11px] text-[#73706A] truncate">{email}</p>
      <p className="text-[10px] text-[#9E9A91] mt-0.5">Since {memberSince}</p>
      <div className="mt-2 grid grid-cols-2 gap-1">
        {stats.map(({ label: l, value, alert }) => (
          <div key={l} className="text-[10.5px]">
            <span className="text-[#9E9A91]">{l}: </span>
            <span
              className={`font-semibold ${alert ? "text-red-600" : "text-[#141414]"}`}
            >
              {value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Resolution Actions Panel ─────────────────────────────────────────────

function ResolutionActions({
  orderId,
  totalNzd,
  buyerId,
  sellerId,
  autoResolution,
  onResolved,
}: {
  orderId: string;
  totalNzd: number;
  buyerId: string;
  sellerId: string;
  autoResolution: AutoResolution | null;
  onResolved: () => void;
}) {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [showPartial, setShowPartial] = useState(false);
  const [showRequestInfo, setShowRequestInfo] = useState(false);
  const [showFraud, setShowFraud] = useState(false);
  const [showOverride, setShowOverride] = useState(false);

  // Form state
  const [reason, setReason] = useState("");
  const [partialAmount, setPartialAmount] = useState("");
  const [infoTarget, setInfoTarget] = useState<"buyer" | "seller" | "both">(
    "buyer",
  );
  const [infoMessage, setInfoMessage] = useState("");
  const [fraudTarget, setFraudTarget] = useState<"buyer" | "seller">("buyer");
  const [fraudReason, setFraudReason] = useState("");
  const [overrideDecision, setOverrideDecision] = useState<
    "refund" | "dismiss" | "partial_refund"
  >("refund");
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideAmount, setOverrideAmount] = useState("");

  const isQueued = autoResolution?.status === "QUEUED";
  const maxRefund = totalNzd / 100;

  async function handleResolve(favour: "buyer" | "seller") {
    const label =
      favour === "buyer" ? "refund the buyer" : "release funds to seller";
    if (!reason.trim()) {
      setError("Please provide a reason for your decision.");
      return;
    }
    if (
      !confirm(
        `Are you sure you want to ${label}? This action processes the payment.`,
      )
    )
      return;
    setLoading(favour);
    setError("");
    const result = await resolveDispute(orderId, favour);
    setLoading(null);
    if (!result.success) {
      setError(result.error);
    } else {
      onResolved();
    }
  }

  async function handlePartialRefund() {
    const cents = Math.round(parseFloat(partialAmount) * 100);
    if (!cents || cents <= 0 || cents > totalNzd) {
      setError(`Amount must be between $0.01 and $${maxRefund.toFixed(2)}.`);
      return;
    }
    if (!reason.trim()) {
      setError("Please provide a reason.");
      return;
    }
    setLoading("partial");
    setError("");
    const result = await resolveDisputePartialRefund({
      orderId,
      amountCents: cents,
      reason,
    });
    setLoading(null);
    if (!result.success) {
      setError(result.error);
    } else {
      onResolved();
    }
  }

  async function handleRequestInfo() {
    if (!infoMessage.trim() || infoMessage.length < 10) {
      setError("Message must be at least 10 characters.");
      return;
    }
    setLoading("info");
    setError("");
    const result = await requestMoreInfo({
      orderId,
      target: infoTarget,
      message: infoMessage,
    });
    setLoading(null);
    if (!result.success) {
      setError(result.error);
    } else {
      setShowRequestInfo(false);
      setInfoMessage("");
    }
  }

  async function handleFlagFraud() {
    if (!fraudReason.trim() || fraudReason.length < 10) {
      setError("Reason must be at least 10 characters.");
      return;
    }
    const userId = fraudTarget === "buyer" ? buyerId : sellerId;
    setLoading("fraud");
    setError("");
    const result = await flagUserForFraud({
      userId,
      orderId,
      reason: fraudReason,
    });
    setLoading(null);
    if (!result.success) {
      setError(result.error);
    } else {
      setShowFraud(false);
      setFraudReason("");
    }
  }

  async function handleOverride() {
    if (!overrideReason.trim()) {
      setError("Reason is required for override.");
      return;
    }
    const payload: Record<string, unknown> = {
      orderId,
      newDecision: overrideDecision,
      reason: overrideReason,
    };
    if (overrideDecision === "partial_refund") {
      const cents = Math.round(parseFloat(overrideAmount) * 100);
      if (!cents || cents <= 0 || cents > totalNzd) {
        setError(`Amount must be between $0.01 and $${maxRefund.toFixed(2)}.`);
        return;
      }
      payload.partialAmountCents = cents;
    }
    setLoading("override");
    setError("");
    const result = await overrideAutoResolution(payload);
    setLoading(null);
    if (!result.success) {
      setError(result.error);
    } else {
      onResolved();
    }
  }

  return (
    <div className="space-y-3">
      {/* Reason field (shared) */}
      {!showPartial && !showRequestInfo && !showFraud && !showOverride && (
        <>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for your decision (mandatory)..."
            className="w-full border border-[#E3E0D9] rounded-lg p-2.5 text-[12.5px] text-[#141414] placeholder-[#C9C5BC] resize-none focus:outline-none focus:ring-2 focus:ring-[#D4A843]/40"
            rows={2}
          />

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => handleResolve("buyer")}
              disabled={loading !== null}
              className="px-3 py-2.5 rounded-xl text-[12px] font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
            >
              {loading === "buyer" ? "..." : "Full Refund to Buyer"}
            </button>
            <button
              onClick={() => setShowPartial(true)}
              disabled={loading !== null}
              className="px-3 py-2.5 rounded-xl text-[12px] font-semibold bg-amber-500 text-white hover:bg-amber-600 transition-colors disabled:opacity-50"
            >
              Partial Refund
            </button>
            <button
              onClick={() => handleResolve("seller")}
              disabled={loading !== null}
              className="px-3 py-2.5 rounded-xl text-[12px] font-semibold bg-[#E3E0D9] text-[#141414] hover:bg-[#D5D2CB] transition-colors disabled:opacity-50"
            >
              {loading === "seller" ? "..." : "Dismiss — Seller's Favour"}
            </button>
            <button
              onClick={() => setShowRequestInfo(true)}
              disabled={loading !== null}
              className="px-3 py-2.5 rounded-xl text-[12px] font-semibold bg-sky-500 text-white hover:bg-sky-600 transition-colors disabled:opacity-50"
            >
              Request More Info
            </button>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setShowFraud(true)}
              disabled={loading !== null}
              className="flex-1 px-3 py-2 rounded-xl text-[11.5px] font-semibold bg-red-100 text-red-700 hover:bg-red-200 transition-colors disabled:opacity-50"
            >
              Flag for Fraud
            </button>
            {isQueued && (
              <button
                onClick={() => setShowOverride(true)}
                disabled={loading !== null}
                className="flex-1 px-3 py-2 rounded-xl text-[11.5px] font-semibold bg-purple-100 text-purple-700 hover:bg-purple-200 transition-colors disabled:opacity-50"
              >
                Override Auto-Resolution
              </button>
            )}
          </div>
        </>
      )}

      {/* Partial refund form */}
      {showPartial && (
        <div className="space-y-2 bg-amber-50 rounded-xl p-3 border border-amber-200">
          <p className="text-[11px] font-semibold text-amber-700">
            Partial Refund (max ${maxRefund.toFixed(2)})
          </p>
          <input
            type="number"
            step="0.01"
            min="0.01"
            max={maxRefund}
            value={partialAmount}
            onChange={(e) => setPartialAmount(e.target.value)}
            placeholder="Amount in NZD"
            className="w-full border border-amber-300 rounded-lg p-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-amber-400/40"
          />
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason..."
            className="w-full border border-amber-300 rounded-lg p-2 text-[12px] resize-none focus:outline-none focus:ring-2 focus:ring-amber-400/40"
            rows={2}
          />
          <div className="flex gap-2">
            <button
              onClick={handlePartialRefund}
              disabled={loading !== null}
              className="flex-1 px-3 py-2 rounded-lg text-[12px] font-semibold bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50"
            >
              {loading === "partial" ? "..." : "Issue Partial Refund"}
            </button>
            <button
              onClick={() => setShowPartial(false)}
              className="px-3 py-2 rounded-lg text-[12px] font-semibold bg-white text-[#73706A] border border-[#E3E0D9]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Request info form */}
      {showRequestInfo && (
        <div className="space-y-2 bg-sky-50 rounded-xl p-3 border border-sky-200">
          <p className="text-[11px] font-semibold text-sky-700">
            Request more information
          </p>
          <select
            value={infoTarget}
            onChange={(e) =>
              setInfoTarget(e.target.value as "buyer" | "seller" | "both")
            }
            className="w-full border border-sky-300 rounded-lg p-2 text-[12px] focus:outline-none"
          >
            <option value="buyer">Send to buyer</option>
            <option value="seller">Send to seller</option>
            <option value="both">Send to both</option>
          </select>
          <textarea
            value={infoMessage}
            onChange={(e) => setInfoMessage(e.target.value)}
            placeholder="What information do you need?..."
            className="w-full border border-sky-300 rounded-lg p-2 text-[12px] resize-none focus:outline-none"
            rows={3}
          />
          <div className="flex gap-2">
            <button
              onClick={handleRequestInfo}
              disabled={loading !== null}
              className="flex-1 px-3 py-2 rounded-lg text-[12px] font-semibold bg-sky-500 text-white hover:bg-sky-600 disabled:opacity-50"
            >
              {loading === "info" ? "..." : "Send Request"}
            </button>
            <button
              onClick={() => setShowRequestInfo(false)}
              className="px-3 py-2 rounded-lg text-[12px] font-semibold bg-white text-[#73706A] border border-[#E3E0D9]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Fraud flag form */}
      {showFraud && (
        <div className="space-y-2 bg-red-50 rounded-xl p-3 border border-red-200">
          <p className="text-[11px] font-semibold text-red-700">
            Flag user for fraud
          </p>
          <select
            value={fraudTarget}
            onChange={(e) =>
              setFraudTarget(e.target.value as "buyer" | "seller")
            }
            className="w-full border border-red-300 rounded-lg p-2 text-[12px] focus:outline-none"
          >
            <option value="buyer">Flag buyer</option>
            <option value="seller">Flag seller</option>
          </select>
          <textarea
            value={fraudReason}
            onChange={(e) => setFraudReason(e.target.value)}
            placeholder="Reason for fraud flag..."
            className="w-full border border-red-300 rounded-lg p-2 text-[12px] resize-none focus:outline-none"
            rows={2}
          />
          <div className="flex gap-2">
            <button
              onClick={handleFlagFraud}
              disabled={loading !== null}
              className="flex-1 px-3 py-2 rounded-lg text-[12px] font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
            >
              {loading === "fraud" ? "..." : "Flag for Fraud"}
            </button>
            <button
              onClick={() => setShowFraud(false)}
              className="px-3 py-2 rounded-lg text-[12px] font-semibold bg-white text-[#73706A] border border-[#E3E0D9]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Override form */}
      {showOverride && (
        <div className="space-y-2 bg-purple-50 rounded-xl p-3 border border-purple-200">
          <p className="text-[11px] font-semibold text-purple-700">
            Override auto-resolution
          </p>
          <p className="text-[10.5px] text-purple-600">
            Current: {autoResolution?.decision?.replace(/_/g, " ")} (score:{" "}
            {autoResolution?.score})
          </p>
          <select
            value={overrideDecision}
            onChange={(e) =>
              setOverrideDecision(
                e.target.value as "refund" | "dismiss" | "partial_refund",
              )
            }
            className="w-full border border-purple-300 rounded-lg p-2 text-[12px] focus:outline-none"
          >
            <option value="refund">Full refund to buyer</option>
            <option value="dismiss">Dismiss — seller's favour</option>
            <option value="partial_refund">Partial refund</option>
          </select>
          {overrideDecision === "partial_refund" && (
            <input
              type="number"
              step="0.01"
              min="0.01"
              max={maxRefund}
              value={overrideAmount}
              onChange={(e) => setOverrideAmount(e.target.value)}
              placeholder="Amount in NZD"
              className="w-full border border-purple-300 rounded-lg p-2 text-[12px] focus:outline-none"
            />
          )}
          <textarea
            value={overrideReason}
            onChange={(e) => setOverrideReason(e.target.value)}
            placeholder="Reason for override..."
            className="w-full border border-purple-300 rounded-lg p-2 text-[12px] resize-none focus:outline-none"
            rows={2}
          />
          <div className="flex gap-2">
            <button
              onClick={handleOverride}
              disabled={loading !== null}
              className="flex-1 px-3 py-2 rounded-lg text-[12px] font-semibold bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
            >
              {loading === "override" ? "..." : "Apply Override"}
            </button>
            <button
              onClick={() => setShowOverride(false)}
              className="px-3 py-2 rounded-lg text-[12px] font-semibold bg-white text-[#73706A] border border-[#E3E0D9]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="text-[11.5px] text-red-600 font-medium">{error}</p>
      )}
    </div>
  );
}
