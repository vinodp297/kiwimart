"use client";
// src/app/(protected)/admin/disputes/DisputeQueue.tsx
// ─── Categorised Dispute Queue with Tabs ─────────────────────────────────

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { getThumbUrl } from "@/lib/image";
import { formatPrice } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────

interface DisputeItem {
  id: string;
  totalNzd: number;
  disputeReason: string | null;
  disputeNotes: string | null;
  disputeOpenedAt: string | null;
  sellerResponse: string | null;
  sellerRespondedAt: string | null;
  listing: {
    id: string;
    title: string;
    priceNzd: number;
    images: { r2Key: string; thumbnailKey: string | null }[];
  };
  buyer: { id: string; email: string; displayName: string };
  seller: {
    id: string;
    email: string;
    displayName: string;
    idVerified: boolean;
  };
  autoResolution: {
    decision: string;
    score: number;
    recommendation: string;
    status: string;
    executeAt: string | null;
    factors: Array<{ factor: string; points: number; description: string }>;
  } | null;
  daysOpen: number;
}

interface QueueStats {
  needsDecision: number;
  coolingPeriod: number;
  fraudAlerts: number;
  autoResolved: number;
  totalOpen: number;
  avgResolutionHours: number;
  autoResolvedThisMonth: number;
  autoResolvedPercentThisMonth: number;
}

type TabKey = "needs_decision" | "cooling" | "fraud" | "auto_resolved" | "all";

interface Props {
  initialTab: TabKey;
  initialItems: DisputeItem[];
  stats: QueueStats;
  allTabs: Record<TabKey, DisputeItem[]>;
}

// ── Helpers ──────────────────────────────────────────────────────────────

const REASON_LABELS: Record<string, string> = {
  ITEM_NOT_RECEIVED: "Not received",
  ITEM_NOT_AS_DESCRIBED: "Not as described",
  ITEM_DAMAGED: "Damaged",
  WRONG_ITEM_SENT: "Wrong item",
  COUNTERFEIT_ITEM: "Counterfeit",
  SELLER_UNRESPONSIVE: "Seller unresponsive",
  SELLER_CANCELLED: "Seller cancelled",
  REFUND_NOT_PROCESSED: "Refund issue",
  OTHER: "Other",
};

const REASON_COLORS: Record<string, string> = {
  ITEM_NOT_RECEIVED: "bg-yellow-50 text-yellow-700 border-yellow-200",
  ITEM_NOT_AS_DESCRIBED: "bg-orange-50 text-orange-700 border-orange-200",
  ITEM_DAMAGED: "bg-red-50 text-red-700 border-red-200",
  WRONG_ITEM_SENT: "bg-red-50 text-red-700 border-red-200",
  COUNTERFEIT_ITEM: "bg-red-50 text-red-800 border-red-300",
  SELLER_UNRESPONSIVE: "bg-amber-50 text-amber-700 border-amber-200",
  OTHER: "bg-gray-50 text-gray-600 border-gray-200",
};

const DECISION_LABELS: Record<string, string> = {
  AUTO_REFUND: "Refund buyer",
  AUTO_DISMISS: "Dismiss",
  ESCALATE_HUMAN: "Needs decision",
  FLAG_FRAUD: "Fraud alert",
};

const DECISION_COLORS: Record<string, string> = {
  AUTO_REFUND: "text-emerald-700",
  AUTO_DISMISS: "text-sky-700",
  ESCALATE_HUMAN: "text-amber-700",
  FLAG_FRAUD: "text-red-700",
};

const TAB_CONFIG: {
  key: TabKey;
  label: string;
  icon: string;
  countKey: keyof QueueStats | null;
  badge?: "red";
}[] = [
  {
    key: "needs_decision",
    label: "Needs Decision",
    icon: "⚡",
    countKey: "needsDecision",
  },
  {
    key: "cooling",
    label: "Cooling Period",
    icon: "⏳",
    countKey: "coolingPeriod",
  },
  {
    key: "fraud",
    label: "Fraud Alerts",
    icon: "🚨",
    countKey: "fraudAlerts",
    badge: "red",
  },
  {
    key: "auto_resolved",
    label: "Auto-Resolved",
    icon: "✓",
    countKey: "autoResolved",
  },
  { key: "all", label: "All Disputes", icon: "📋", countKey: "totalOpen" },
];

// ── Component ────────────────────────────────────────────────────────────

export default function DisputeQueue({
  initialTab,
  initialItems,
  stats,
  allTabs,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);
  const items = allTabs[activeTab] ?? initialItems;

  return (
    <div className="space-y-6">
      {/* Quick stats bar */}
      <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          {
            label: "Open",
            value: stats.totalOpen,
            alert: stats.totalOpen > 0,
          },
          {
            label: "Needs Decision",
            value: stats.needsDecision,
            alert: stats.needsDecision > 0,
          },
          {
            label: "Fraud Alerts",
            value: stats.fraudAlerts,
            alert: stats.fraudAlerts > 0,
          },
          {
            label: "Avg Resolution",
            value:
              stats.avgResolutionHours > 48
                ? `${Math.round(stats.avgResolutionHours / 24)}d`
                : `${stats.avgResolutionHours}h`,
            alert: false,
          },
          {
            label: "Auto-Resolved",
            value: stats.autoResolvedThisMonth,
            alert: false,
          },
          {
            label: "Auto %",
            value: `${stats.autoResolvedPercentThisMonth}%`,
            alert: false,
          },
        ].map(({ label, value, alert }) => (
          <div
            key={label}
            className={`bg-white rounded-xl border p-3 ${
              alert ? "border-red-200 bg-red-50" : "border-[#E3E0D9]"
            }`}
          >
            <p className="text-[10px] text-[#9E9A91] font-medium uppercase tracking-wider">
              {label}
            </p>
            <p className="font-[family-name:var(--font-playfair)] text-[1.25rem] font-semibold text-[#141414] leading-none mt-1">
              {value}
            </p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[#F0EDE8] rounded-xl p-1 overflow-x-auto">
        {TAB_CONFIG.map(({ key, label, icon, countKey, badge }) => {
          const count = countKey ? stats[countKey] : 0;
          const isActive = activeTab === key;
          return (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12.5px] font-medium whitespace-nowrap transition-all ${
                isActive
                  ? "bg-white text-[#141414] shadow-sm"
                  : "text-[#73706A] hover:text-[#141414] hover:bg-white/50"
              }`}
            >
              <span className="text-[13px]">{icon}</span>
              {label}
              {typeof count === "number" && count > 0 && (
                <span
                  className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                    badge === "red"
                      ? "bg-red-100 text-red-700"
                      : isActive
                        ? "bg-[#141414] text-white"
                        : "bg-[#E3E0D9] text-[#73706A]"
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Dispute list */}
      {items.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#E3E0D9] p-12 text-center">
          <p className="text-[14px] text-[#9E9A91]">
            {activeTab === "needs_decision"
              ? "No disputes need your decision right now."
              : activeTab === "cooling"
                ? "No auto-resolutions in cooling period."
                : activeTab === "fraud"
                  ? "No fraud alerts."
                  : activeTab === "auto_resolved"
                    ? "No auto-resolved disputes yet."
                    : "No disputes found."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((d) => (
            <DisputeCard key={d.id} dispute={d} tab={activeTab} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Dispute Card ─────────────────────────────────────────────────────────

function DisputeCard({
  dispute: d,
  tab,
}: {
  dispute: DisputeItem;
  tab: TabKey;
}) {
  const thumbUrl = getThumbUrl(d.listing.images[0]);
  const reasonLabel = d.disputeReason
    ? (REASON_LABELS[d.disputeReason] ?? d.disputeReason)
    : null;
  const reasonColor = d.disputeReason
    ? (REASON_COLORS[d.disputeReason] ?? REASON_COLORS.OTHER!)
    : REASON_COLORS.OTHER!;

  const urgencyColor =
    d.daysOpen > 7
      ? "bg-red-50 text-red-700 border-red-200"
      : d.daysOpen > 3
        ? "bg-amber-50 text-amber-700 border-amber-200"
        : "bg-[#F0EDE8] text-[#73706A] border-[#E3E0D9]";

  const isCooling = tab === "cooling" && d.autoResolution?.executeAt;
  const coolingTimeLeft = isCooling
    ? getCoolingTimeLeft(d.autoResolution!.executeAt!)
    : null;

  return (
    <div
      className={`bg-white rounded-2xl border overflow-hidden ${
        tab === "fraud"
          ? "border-red-300 ring-1 ring-red-100"
          : "border-[#E3E0D9]"
      }`}
    >
      <div className="p-4 flex items-start gap-3">
        {/* Thumbnail */}
        {thumbUrl ? (
          <div className="relative w-12 h-12 rounded-lg overflow-hidden border border-[#E3E0D9] flex-shrink-0">
            <Image
              src={thumbUrl}
              alt={d.listing.title}
              fill
              className="object-cover"
              sizes="48px"
            />
          </div>
        ) : (
          <div className="w-12 h-12 rounded-lg bg-[#F8F7F4] border border-[#E3E0D9] flex-shrink-0 flex items-center justify-center text-lg">
            📦
          </div>
        )}

        {/* Details */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-semibold text-[#141414] truncate max-w-[200px]">
              {d.listing.title}
            </span>
            <span className="text-[12px] font-semibold text-[#D4A843]">
              {formatPrice(d.totalNzd / 100)}
            </span>
            {reasonLabel && (
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${reasonColor}`}
              >
                {reasonLabel}
              </span>
            )}
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${urgencyColor}`}
            >
              {d.daysOpen}d open
            </span>
          </div>

          <div className="flex items-center gap-3 mt-1 text-[11.5px] text-[#73706A]">
            <span>
              Buyer: <b className="text-[#141414]">{d.buyer.displayName}</b>
            </span>
            <span className="text-[#E3E0D9]">|</span>
            <span>
              Seller: <b className="text-[#141414]">{d.seller.displayName}</b>
              {d.seller.idVerified && (
                <span className="ml-1 text-emerald-600 text-[10px]">✓ ID</span>
              )}
            </span>
          </div>

          {/* Auto-resolution recommendation */}
          {d.autoResolution && (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[11px] text-[#9E9A91]">System:</span>
              <span
                className={`text-[11.5px] font-semibold ${
                  DECISION_COLORS[d.autoResolution.decision] ?? "text-[#141414]"
                }`}
              >
                {DECISION_LABELS[d.autoResolution.decision] ??
                  d.autoResolution.decision}{" "}
                (score: {d.autoResolution.score >= 0 ? "+" : ""}
                {d.autoResolution.score})
              </span>
              {isCooling && coolingTimeLeft && (
                <span className="text-[10.5px] text-amber-600 font-medium">
                  Executes in {coolingTimeLeft}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Action */}
        <Link
          href={`/admin/disputes/${d.id}`}
          className="flex-shrink-0 px-3 py-2 rounded-lg text-[12px] font-semibold bg-[#141414] text-white hover:bg-[#2a2a2a] transition-colors"
        >
          View case
        </Link>
      </div>
    </div>
  );
}

function getCoolingTimeLeft(executeAt: string): string | null {
  const ms = new Date(executeAt).getTime() - Date.now();
  if (ms <= 0) return "overdue";
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const mins = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}
