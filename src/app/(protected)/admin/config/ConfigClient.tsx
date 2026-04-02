"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ConfigRecord } from "@/server/actions/admin-config";
import { updateConfig } from "@/server/actions/admin-config";

// ── Category metadata ────────────────────────────────────────────────────────

const CATEGORIES = [
  {
    key: "SELLER_TIERS",
    label: "Seller Tiers",
    icon: "🏆",
    description:
      "Controls how sellers earn and lose tier status, and what limits apply at each tier.",
  },
  {
    key: "FINANCIAL",
    label: "Financial",
    icon: "💰",
    description:
      "Shipping rates, price caps, and payment timing. Changes affect all active transactions.",
  },
  {
    key: "TIME_LIMITS",
    label: "Time Limits",
    icon: "⏱️",
    description:
      "Windows for buyer actions, seller responses, and automated system decisions.",
  },
  {
    key: "LISTING_RULES",
    label: "Listing Rules",
    icon: "📋",
    description:
      "Validation requirements and auto-review thresholds for new listings.",
  },
  {
    key: "FRAUD_RULES",
    label: "Fraud Rules",
    icon: "🛡️",
    description:
      "Risk scoring weights and auto-resolution thresholds. High impact — change with care.",
  },
  {
    key: "PICKUP_RULES",
    label: "Pickup Rules",
    icon: "📍",
    description:
      "Timing rules for in-person pickup orders and OTP confirmation flow.",
  },
] as const;

const HIGH_IMPACT_CATEGORIES = new Set(["FRAUD_RULES", "FINANCIAL"]);

// ── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(isoString: string): string {
  const ms = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDisplayValue(value: string, unit: string | null): string {
  if (unit === "cents") {
    const dollars = (parseInt(value, 10) / 100).toFixed(2);
    return `$${dollars} (${value} cents)`;
  }
  return unit ? `${value} ${unit}` : value;
}

// ── Component ────────────────────────────────────────────────────────────────

interface Props {
  configs: Record<string, ConfigRecord[]>;
}

export default function ConfigClient({ configs }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [activeCategory, setActiveCategory] = useState<string>("SELLER_TIERS");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    key: string;
    type: "success" | "error";
    message: string;
  } | null>(null);

  const activeCategoryMeta = CATEGORIES.find((c) => c.key === activeCategory);
  const activeRecords = configs[activeCategory] ?? [];

  function startEdit(record: ConfigRecord) {
    setEditingKey(record.key);
    setEditValue(record.value);
    setFeedback(null);
  }

  function cancelEdit() {
    setEditingKey(null);
    setEditValue("");
    setFeedback(null);
  }

  async function handleSave(key: string) {
    setSaving(true);
    setFeedback(null);
    const result = await updateConfig(key, editValue);
    setSaving(false);
    if (result.success) {
      setFeedback({ key, type: "success", message: "Saved" });
      setEditingKey(null);
      startTransition(() => router.refresh());
    } else {
      setFeedback({
        key,
        type: "error",
        message: result.error ?? "Failed to save",
      });
    }
  }

  return (
    <div className="bg-[#FAFAF8] min-h-screen">
      {/* Header band */}
      <div className="bg-[#141414] text-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
          <p className="text-[11px] text-white/40 uppercase tracking-wider mb-2">
            Admin / Settings
          </p>
          <div className="flex items-center gap-3 mb-1">
            <span className="text-[#D4A843] text-xl">⚙️</span>
            <h1 className="font-[family-name:var(--font-playfair)] text-[1.75rem] font-semibold">
              Platform Settings
            </h1>
          </div>
          <p className="text-white/50 text-[13.5px]">
            Changes take effect within 5 minutes as the cache refreshes.
          </p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        {/* Warning banner */}
        <div className="bg-[#FEF3C7] border border-amber-300/50 rounded-xl px-5 py-4 mb-8 flex items-start gap-3">
          <span className="text-amber-600 text-lg mt-0.5">⚠️</span>
          <p className="text-[13px] text-amber-900 leading-relaxed">
            Settings marked{" "}
            <span className="bg-red-100 text-red-700 text-[11px] font-semibold px-1.5 py-0.5 rounded">
              High impact
            </span>{" "}
            affect live transactions and financial outcomes. Review carefully
            before saving.
          </p>
        </div>

        <div className="flex gap-8">
          {/* Category tabs — left sidebar */}
          <nav className="w-52 flex-shrink-0">
            <div className="bg-white rounded-2xl border border-[#E3E0D9] overflow-hidden">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.key}
                  onClick={() => {
                    setActiveCategory(cat.key);
                    cancelEdit();
                  }}
                  className={`w-full text-left px-4 py-3 text-[13px] flex items-center gap-2.5 transition-colors border-b border-[#F0EDE8] last:border-b-0 ${
                    activeCategory === cat.key
                      ? "bg-[#141414] text-white font-medium"
                      : "text-[#73706A] hover:bg-[#F8F7F4]"
                  }`}
                >
                  <span className="text-base">{cat.icon}</span>
                  {cat.label}
                </button>
              ))}
            </div>
          </nav>

          {/* Config rows — right content */}
          <div className="flex-1 min-w-0">
            {/* Category description */}
            {activeCategoryMeta && (
              <p className="text-[13px] text-[#9E9A91] mb-6 leading-relaxed">
                {activeCategoryMeta.description}
              </p>
            )}

            <div className="space-y-3">
              {activeRecords.map((record) => {
                const isEditing = editingKey === record.key;
                const isHighImpact = HIGH_IMPACT_CATEGORIES.has(
                  record.category,
                );
                const fb = feedback?.key === record.key ? feedback : null;

                return (
                  <div
                    key={record.key}
                    className="bg-white rounded-2xl border border-[#E3E0D9] p-5"
                  >
                    {/* Header row */}
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-[14px] font-semibold text-[#141414]">
                        {record.label}
                      </h3>
                      {isHighImpact && (
                        <span className="bg-red-100 text-red-700 text-[10px] font-semibold px-1.5 py-0.5 rounded">
                          High impact
                        </span>
                      )}
                    </div>

                    {/* Description */}
                    <p className="text-[12.5px] text-[#9E9A91] mb-3 leading-relaxed">
                      {record.description}
                    </p>

                    {isEditing ? (
                      /* ── Edit mode ──────────────────────────────────── */
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          {record.type === "BOOLEAN" ? (
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={editValue === "true"}
                                onChange={(e) =>
                                  setEditValue(
                                    e.target.checked ? "true" : "false",
                                  )
                                }
                                className="w-4 h-4 accent-[#D4A843] rounded"
                              />
                              <span className="text-[13px] text-[#141414]">
                                {editValue === "true" ? "Enabled" : "Disabled"}
                              </span>
                            </label>
                          ) : record.type === "JSON" ? (
                            <textarea
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              rows={4}
                              className="w-full text-[13px] border border-[#E3E0D9] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#D4A843]/40 font-mono"
                            />
                          ) : (
                            <>
                              <input
                                type={
                                  record.type === "INTEGER" ||
                                  record.type === "DECIMAL"
                                    ? "number"
                                    : "text"
                                }
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                step={record.type === "DECIMAL" ? "0.1" : "1"}
                                className="w-40 text-[13px] border border-[#E3E0D9] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#D4A843]/40"
                              />
                              {record.unit && (
                                <span className="text-[12px] text-[#9E9A91]">
                                  {record.unit}
                                </span>
                              )}
                            </>
                          )}
                        </div>

                        {/* Min/max hint */}
                        {(record.minValue || record.maxValue) && (
                          <p className="text-[11px] text-[#C9C5BC] mb-3">
                            Range: {record.minValue ?? "—"} to{" "}
                            {record.maxValue ?? "—"}
                            {record.unit ? ` ${record.unit}` : ""}
                          </p>
                        )}

                        {/* Feedback */}
                        {fb && (
                          <p
                            className={`text-[12px] mb-2 ${
                              fb.type === "success"
                                ? "text-green-600"
                                : "text-red-600"
                            }`}
                          >
                            {fb.message}
                          </p>
                        )}

                        {/* Actions */}
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleSave(record.key)}
                            disabled={saving}
                            className="bg-[#D4A843] text-[#141414] text-[13px] font-semibold px-4 py-2 rounded-lg hover:bg-[#C49A3A] disabled:opacity-50 transition-colors"
                          >
                            {saving ? "Saving..." : "Save changes"}
                          </button>
                          <button
                            onClick={cancelEdit}
                            disabled={saving}
                            className="bg-[#F0EDE8] text-[#141414] text-[13px] px-4 py-2 rounded-lg hover:bg-[#E3E0D9] disabled:opacity-50 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* ── Display mode ───────────────────────────────── */
                      <div>
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="text-[13px] text-[#141414] font-medium">
                              Current:{" "}
                              {formatDisplayValue(record.value, record.unit)}
                            </span>
                          </div>
                          <button
                            onClick={() => startEdit(record)}
                            className="text-[12px] text-[#D4A843] font-semibold hover:text-[#C49A3A] transition-colors"
                          >
                            Edit
                          </button>
                        </div>

                        {/* Feedback after save */}
                        {fb && fb.type === "success" && (
                          <p className="text-[12px] text-green-600 mt-1">
                            {fb.message}
                          </p>
                        )}

                        {/* Updated by */}
                        <p className="text-[11px] text-[#C9C5BC] mt-1">
                          {record.updaterName
                            ? `Updated by ${record.updaterName} · ${relativeTime(record.updatedAt)}`
                            : "Default value"}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}

              {activeRecords.length === 0 && (
                <p className="text-[13px] text-[#9E9A91] py-8 text-center">
                  No settings found for this category. Run the seed to
                  initialise.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
