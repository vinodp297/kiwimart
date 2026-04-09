"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateConfig } from "@/server/actions/admin-config";
import { fromCents } from "@/lib/currency";
import type { ConfigRecord } from "@/server/actions/admin-config";
import type { FeeBreakdown } from "@/modules/payments/fee-calculator";

// ── Types ────────────────────────────────────────────────────────────────────

interface FeePreviewProps {
  label: string;
  tier: string;
  breakdown: FeeBreakdown;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtNzd(cents: number): string {
  return `$${fromCents(cents).toFixed(2)}`;
}

function fmtPct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function relativeTime(isoString: string): string {
  const ms = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ── Fee Preview Panel ─────────────────────────────────────────────────────────

function FeePreviewCard({ label, tier, breakdown }: FeePreviewProps) {
  const tierColors: Record<string, string> = {
    Standard: "bg-[#F0EDE8] text-[#73706A]",
    Silver: "bg-slate-100 text-slate-600",
    Gold: "bg-amber-50 text-amber-700",
  };

  return (
    <div className="bg-white rounded-2xl border border-[#E3E0D9] p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-[13px] font-semibold text-[#141414]">{label}</h4>
        <span
          className={`text-[10px] font-semibold px-2 py-0.5 rounded ${tierColors[tier] ?? "bg-gray-100 text-gray-600"}`}
        >
          {tier}
        </span>
      </div>
      <div className="space-y-1.5 text-[12px]">
        <div className="flex justify-between">
          <span className="text-[#73706A]">Gross amount</span>
          <span className="text-[#141414] font-medium">
            {fmtNzd(breakdown.grossAmountCents)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#73706A]">
            Platform fee ({fmtPct(breakdown.platformFeeRate)})
          </span>
          <span className="text-red-600">−{fmtNzd(breakdown.platformFee)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#73706A]">Stripe fee (est.)</span>
          <span className="text-red-600">−{fmtNzd(breakdown.stripeFee)}</span>
        </div>
        <div className="flex justify-between pt-1.5 border-t border-[#F0EDE8] font-semibold">
          <span className="text-[#141414]">Seller receives</span>
          <span className="text-emerald-600">
            {fmtNzd(breakdown.sellerPayout)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Config Row ────────────────────────────────────────────────────────────────

interface ConfigRowProps {
  record: ConfigRecord;
  onSaved: () => void;
}

function ConfigRow({ record, onSaved }: ConfigRowProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(record.value);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const isStripeKey = record.key.includes("stripe");

  async function handleSave() {
    setSaving(true);
    setFeedback(null);
    const result = await updateConfig(record.key, editValue);
    setSaving(false);
    if (result.success) {
      setFeedback({ type: "success", message: "Saved" });
      setEditing(false);
      onSaved();
    } else {
      setFeedback({ type: "error", message: result.error ?? "Failed to save" });
    }
  }

  function startEdit() {
    setEditValue(record.value);
    setFeedback(null);
    setEditing(true);
  }

  return (
    <div
      className={`bg-white rounded-2xl border p-5 ${isStripeKey ? "border-amber-200" : "border-[#E3E0D9]"}`}
    >
      <div className="flex items-center gap-2 mb-1">
        <h3 className="text-[14px] font-semibold text-[#141414]">
          {record.label}
        </h3>
        {isStripeKey && (
          <span className="bg-amber-100 text-amber-700 text-[10px] font-semibold px-1.5 py-0.5 rounded">
            Stripe rate
          </span>
        )}
      </div>
      <p className="text-[12.5px] text-[#9E9A91] mb-3 leading-relaxed">
        {record.description}
      </p>

      {editing ? (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <input
              type="number"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              step={record.type === "DECIMAL" ? "0.1" : "1"}
              className="w-32 text-[13px] border border-[#E3E0D9] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#D4A843]/40"
            />
            {record.unit && (
              <span className="text-[12px] text-[#9E9A91]">{record.unit}</span>
            )}
          </div>
          {feedback && (
            <p
              className={`text-[12px] mb-2 ${feedback.type === "success" ? "text-green-600" : "text-red-600"}`}
            >
              {feedback.message}
            </p>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-[#D4A843] text-[#141414] text-[13px] font-semibold px-4 py-2 rounded-lg hover:bg-[#C49A3A] disabled:opacity-50 transition-colors"
            >
              {saving ? "Saving..." : "Save"}
            </button>
            <button
              onClick={() => setEditing(false)}
              disabled={saving}
              className="bg-[#F0EDE8] text-[#141414] text-[13px] px-4 py-2 rounded-lg hover:bg-[#E3E0D9] disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <div>
            <span className="text-[13px] text-[#141414] font-medium">
              {record.value}
              {record.unit ? ` ${record.unit}` : ""}
            </span>
            <p className="text-[11px] text-[#C9C5BC] mt-0.5">
              {record.updaterName
                ? `Updated by ${record.updaterName} · ${relativeTime(record.updatedAt)}`
                : "Default value"}
            </p>
          </div>
          <button
            onClick={startEdit}
            className="text-[12px] text-[#D4A843] font-semibold hover:text-[#C49A3A] transition-colors"
          >
            Edit
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

interface Props {
  configs: ConfigRecord[];
  previews: {
    standard100: FeeBreakdown;
    silver100: FeeBreakdown;
    gold100: FeeBreakdown;
  };
}

export default function FeeConfigClient({ configs, previews }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  function handleSaved() {
    startTransition(() => router.refresh());
  }

  const tierRates = configs.filter(
    (c) =>
      c.key.includes("platform_standard") ||
      c.key.includes("platform_silver") ||
      c.key.includes("platform_gold"),
  );
  const limits = configs.filter(
    (c) => c.key.includes("minimum") || c.key.includes("maximum"),
  );
  const stripeRates = configs.filter((c) => c.key.includes("stripe"));

  return (
    <div className="bg-[#FAFAF8] min-h-screen">
      {/* Header */}
      <div className="bg-[#141414] text-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
          <p className="text-[11px] text-white/40 uppercase tracking-wider mb-2">
            Admin / Settings / Fees
          </p>
          <div className="flex items-center gap-3 mb-1">
            <span className="text-[#D4A843] text-xl">💰</span>
            <h1 className="font-[family-name:var(--font-playfair)] text-[1.75rem] font-semibold">
              Platform Fee Configuration
            </h1>
          </div>
          <p className="text-white/50 text-[13.5px]">
            Changes take effect within 5 minutes. All amounts in NZD cents
            unless noted.
          </p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        {/* Warning */}
        <div className="bg-[#FEF3C7] border border-amber-300/50 rounded-xl px-5 py-4 flex items-start gap-3">
          <span className="text-amber-600 text-lg mt-0.5">⚠️</span>
          <p className="text-[13px] text-amber-900 leading-relaxed">
            Fee changes affect all future payouts. Existing orders use the rates
            locked at payment time. Stripe rates are informational — they
            reflect Stripe&apos;s actual NZ domestic card rate; changing them
            only affects fee estimates shown to sellers.
          </p>
        </div>

        {/* Seller Tier Rates */}
        <section>
          <h2 className="text-[16px] font-semibold text-[#141414] mb-4">
            Seller Tier Rates
          </h2>
          <div className="space-y-3">
            {tierRates.map((r) => (
              <ConfigRow key={r.key} record={r} onSaved={handleSaved} />
            ))}
          </div>
        </section>

        {/* Fee Limits */}
        <section>
          <h2 className="text-[16px] font-semibold text-[#141414] mb-4">
            Fee Limits
          </h2>
          <div className="space-y-3">
            {limits.map((r) => (
              <ConfigRow key={r.key} record={r} onSaved={handleSaved} />
            ))}
          </div>
        </section>

        {/* Stripe Rates */}
        <section>
          <h2 className="text-[16px] font-semibold text-[#141414] mb-4">
            Stripe Processing Rates
          </h2>
          <p className="text-[12.5px] text-[#9E9A91] mb-4">
            These reflect Stripe&apos;s actual NZ domestic card fees. Update
            only if Stripe changes their pricing.
          </p>
          <div className="space-y-3">
            {stripeRates.map((r) => (
              <ConfigRow key={r.key} record={r} onSaved={handleSaved} />
            ))}
          </div>
        </section>

        {/* Fee Preview */}
        <section>
          <h2 className="text-[16px] font-semibold text-[#141414] mb-2">
            Live Fee Preview
          </h2>
          <p className="text-[12.5px] text-[#9E9A91] mb-4">
            Based on current config values. Calculated for a $100.00 sale.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <FeePreviewCard
              label="Standard seller"
              tier="Standard"
              breakdown={previews.standard100}
            />
            <FeePreviewCard
              label="Silver seller"
              tier="Silver"
              breakdown={previews.silver100}
            />
            <FeePreviewCard
              label="Gold seller"
              tier="Gold"
              breakdown={previews.gold100}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
