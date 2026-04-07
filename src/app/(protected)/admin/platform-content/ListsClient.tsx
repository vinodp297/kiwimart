"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DynamicListType } from "@prisma/client";
import type { ListItemRecord } from "@/server/actions/admin-lists";
import {
  getListItems,
  createListItem,
  updateListItem,
  deleteListItem,
} from "@/server/actions/admin-lists";

// ── Category metadata ────────────────────────────────────────────────────────

const LIST_TYPES: {
  key: DynamicListType;
  label: string;
  icon: string;
  description: string;
}[] = [
  {
    key: "BANNED_KEYWORDS",
    label: "Banned Keywords",
    icon: "\u{1F6AB}",
    description:
      "Keywords that cause an immediate auto-reject in listing review.",
  },
  {
    key: "RISK_KEYWORDS",
    label: "Risk Keywords",
    icon: "\u26A0\uFE0F",
    description: "Keywords that add risk score but do not auto-reject.",
  },
  {
    key: "NZ_REGIONS",
    label: "NZ Regions",
    icon: "\u{1F5FA}\uFE0F",
    description:
      "New Zealand regions with lat/lng coordinates for location features.",
  },
  {
    key: "COURIERS",
    label: "Couriers",
    icon: "\u{1F69A}",
    description: "Available courier/shipping providers.",
  },
  {
    key: "DISPUTE_REASONS",
    label: "Dispute Reasons",
    icon: "\u2696\uFE0F",
    description: "Reasons buyers can select when opening a dispute.",
  },
  {
    key: "LISTING_CONDITIONS",
    label: "Listing Conditions",
    icon: "\u{1F3F7}\uFE0F",
    description: "Item condition options for listings.",
  },
  {
    key: "REVIEW_TAGS",
    label: "Review Tags",
    icon: "\u2B50",
    description: "Positive tag chips buyers can add to seller reviews.",
  },
  {
    key: "REPORT_REASONS",
    label: "Report Reasons",
    icon: "\u{1F6A9}",
    description: "Reasons for reporting a listing or user.",
  },
  {
    key: "SELLER_RESCHEDULE_REASONS",
    label: "Seller Reschedule",
    icon: "\u{1F4C5}",
    description: "Reasons a seller can request to reschedule a pickup.",
  },
  {
    key: "BUYER_RESCHEDULE_REASONS",
    label: "Buyer Reschedule",
    icon: "\u{1F4C6}",
    description: "Reasons a buyer can request to reschedule a pickup.",
  },
  {
    key: "PICKUP_REJECT_REASONS",
    label: "Pickup Reject",
    icon: "\u274C",
    description: "Reasons a buyer can reject an item at pickup.",
  },
  {
    key: "DELIVERY_ISSUE_TYPES",
    label: "Delivery Issues",
    icon: "\u{1F4E6}",
    description: "Types of delivery issues buyers can report.",
  },
  {
    key: "PROBLEM_TYPES",
    label: "Problem Types",
    icon: "\u{1F6E0}\uFE0F",
    description: "Problem options shown in the buyer problem resolver flow.",
  },
  {
    key: "QUICK_FILTER_CHIPS",
    label: "Quick Filters",
    icon: "\u{1F50D}",
    description: "Toggle chips on the search page for fast filtering.",
  },
];

// ── Component ────────────────────────────────────────────────────────────────

interface Props {
  initialItems: ListItemRecord[];
  initialCounts: Record<string, number>;
  initialType: DynamicListType;
}

export default function ListsClient({
  initialItems,
  initialCounts,
  initialType,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [activeType, setActiveType] = useState<DynamicListType>(initialType);
  const [items, setItems] = useState<ListItemRecord[]>(initialItems);
  const [counts, setCounts] = useState(initialCounts);
  const [loading, setLoading] = useState(false);

  // Add form
  const [showAdd, setShowAdd] = useState(false);
  const [addValue, setAddValue] = useState("");
  const [addLabel, setAddLabel] = useState("");
  const [addDescription, setAddDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  // Edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editLabel, setEditLabel] = useState("");
  const [editDescription, setEditDescription] = useState("");

  const activeMeta = LIST_TYPES.find((t) => t.key === activeType);

  async function switchType(type: DynamicListType) {
    setActiveType(type);
    setShowAdd(false);
    setEditingId(null);
    setFeedback(null);
    setLoading(true);
    const result = await getListItems(type);
    if (result.success) setItems(result.data);
    setLoading(false);
  }

  async function handleAdd() {
    if (!addValue.trim()) return;
    setSaving(true);
    setFeedback(null);
    const result = await createListItem({
      listType: activeType,
      value: addValue.trim(),
      label: addLabel.trim() || undefined,
      description: addDescription.trim() || undefined,
    });
    setSaving(false);
    if (result.success) {
      setFeedback({ type: "success", message: "Item added" });
      setAddValue("");
      setAddLabel("");
      setAddDescription("");
      setShowAdd(false);
      setCounts((c) => ({ ...c, [activeType]: (c[activeType] ?? 0) + 1 }));
      // Refresh list
      const refreshed = await getListItems(activeType);
      if (refreshed.success) setItems(refreshed.data);
      startTransition(() => router.refresh());
    } else {
      setFeedback({ type: "error", message: result.error ?? "Failed" });
    }
  }

  function startEdit(item: ListItemRecord) {
    setEditingId(item.id);
    setEditValue(item.value);
    setEditLabel(item.label ?? "");
    setEditDescription(item.description ?? "");
    setFeedback(null);
  }

  async function handleUpdate(id: string) {
    setSaving(true);
    setFeedback(null);
    const result = await updateListItem({
      id,
      value: editValue.trim(),
      label: editLabel.trim() || null,
      description: editDescription.trim() || null,
    });
    setSaving(false);
    if (result.success) {
      setFeedback({ type: "success", message: "Updated" });
      setEditingId(null);
      const refreshed = await getListItems(activeType);
      if (refreshed.success) setItems(refreshed.data);
    } else {
      setFeedback({ type: "error", message: result.error ?? "Failed" });
    }
  }

  async function handleToggleActive(item: ListItemRecord) {
    const result = await updateListItem({
      id: item.id,
      isActive: !item.isActive,
    });
    if (result.success) {
      const refreshed = await getListItems(activeType);
      if (refreshed.success) setItems(refreshed.data);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this item permanently?")) return;
    const result = await deleteListItem(id);
    if (result.success) {
      setCounts((c) => ({
        ...c,
        [activeType]: Math.max(0, (c[activeType] ?? 0) - 1),
      }));
      const refreshed = await getListItems(activeType);
      if (refreshed.success) setItems(refreshed.data);
    }
  }

  return (
    <div className="bg-[#FAFAF8] min-h-screen">
      {/* Header */}
      <div className="bg-[#141414] text-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
          <p className="text-[11px] text-white/40 uppercase tracking-wider mb-2">
            Admin / Platform Content
          </p>
          <div className="flex items-center gap-3 mb-1">
            <span className="text-[#D4A843] text-xl">{"\u{1F4DD}"}</span>
            <h1 className="font-[family-name:var(--font-playfair)] text-[1.75rem] font-semibold">
              Platform Content Manager
            </h1>
          </div>
          <p className="text-white/50 text-[13.5px]">
            Manage content lists used across the platform. Changes take effect
            within 5 minutes.
          </p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex gap-8">
          {/* Sidebar */}
          <nav className="w-56 flex-shrink-0">
            <div className="bg-white rounded-2xl border border-[#E3E0D9] overflow-hidden">
              {LIST_TYPES.map((lt) => (
                <button
                  key={lt.key}
                  onClick={() => switchType(lt.key)}
                  className={`w-full text-left px-4 py-3 text-[13px] flex items-center justify-between gap-2 transition-colors border-b border-[#F0EDE8] last:border-b-0 ${
                    activeType === lt.key
                      ? "bg-[#141414] text-white font-medium"
                      : "text-[#73706A] hover:bg-[#F8F7F4]"
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="text-base">{lt.icon}</span>
                    <span className="truncate">{lt.label}</span>
                  </span>
                  <span
                    className={`text-[11px] px-1.5 py-0.5 rounded-full ${
                      activeType === lt.key
                        ? "bg-white/20 text-white/80"
                        : "bg-[#F0EDE8] text-[#9E9A91]"
                    }`}
                  >
                    {counts[lt.key] ?? 0}
                  </span>
                </button>
              ))}
            </div>
          </nav>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {activeMeta && (
              <p className="text-[13px] text-[#9E9A91] mb-4 leading-relaxed">
                {activeMeta.description}
              </p>
            )}

            {/* Add button */}
            <div className="mb-4">
              {showAdd ? (
                <div className="bg-white rounded-2xl border border-[#E3E0D9] p-5 space-y-3">
                  <div>
                    <label className="text-[12px] text-[#9E9A91] block mb-1">
                      Value *
                    </label>
                    <input
                      value={addValue}
                      onChange={(e) => setAddValue(e.target.value)}
                      className="w-full text-[13px] border border-[#E3E0D9] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#D4A843]/40"
                      placeholder="e.g. keyword, region name, reason code..."
                    />
                  </div>
                  <div>
                    <label className="text-[12px] text-[#9E9A91] block mb-1">
                      Label (optional)
                    </label>
                    <input
                      value={addLabel}
                      onChange={(e) => setAddLabel(e.target.value)}
                      className="w-full text-[13px] border border-[#E3E0D9] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#D4A843]/40"
                      placeholder="Display label..."
                    />
                  </div>
                  <div>
                    <label className="text-[12px] text-[#9E9A91] block mb-1">
                      Description (optional)
                    </label>
                    <input
                      value={addDescription}
                      onChange={(e) => setAddDescription(e.target.value)}
                      className="w-full text-[13px] border border-[#E3E0D9] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#D4A843]/40"
                      placeholder="Short description..."
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleAdd}
                      disabled={saving || !addValue.trim()}
                      className="bg-[#D4A843] text-[#141414] text-[13px] font-semibold px-4 py-2 rounded-lg hover:bg-[#C49A3A] disabled:opacity-50 transition-colors"
                    >
                      {saving ? "Adding..." : "Add item"}
                    </button>
                    <button
                      onClick={() => setShowAdd(false)}
                      className="bg-[#F0EDE8] text-[#141414] text-[13px] px-4 py-2 rounded-lg hover:bg-[#E3E0D9] transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setShowAdd(true);
                    setFeedback(null);
                  }}
                  className="bg-[#D4A843] text-[#141414] text-[13px] font-semibold px-4 py-2 rounded-lg hover:bg-[#C49A3A] transition-colors"
                >
                  + Add item
                </button>
              )}
            </div>

            {/* Feedback */}
            {feedback && (
              <p
                className={`text-[12px] mb-3 ${
                  feedback.type === "success"
                    ? "text-green-600"
                    : "text-red-600"
                }`}
              >
                {feedback.message}
              </p>
            )}

            {/* Items list */}
            {loading ? (
              <p className="text-[13px] text-[#9E9A91] py-8 text-center">
                Loading...
              </p>
            ) : items.length === 0 ? (
              <p className="text-[13px] text-[#9E9A91] py-8 text-center">
                No items found. Run the seed to initialise or add items above.
              </p>
            ) : (
              <div className="space-y-2">
                {items.map((item) => {
                  const isEditing = editingId === item.id;

                  return (
                    <div
                      key={item.id}
                      className={`bg-white rounded-xl border border-[#E3E0D9] px-5 py-3 ${
                        !item.isActive ? "opacity-50" : ""
                      }`}
                    >
                      {isEditing ? (
                        <div className="space-y-2">
                          <input
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            className="w-full text-[13px] border border-[#E3E0D9] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#D4A843]/40"
                          />
                          <input
                            value={editLabel}
                            onChange={(e) => setEditLabel(e.target.value)}
                            placeholder="Label (optional)"
                            className="w-full text-[13px] border border-[#E3E0D9] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#D4A843]/40"
                          />
                          <input
                            value={editDescription}
                            onChange={(e) => setEditDescription(e.target.value)}
                            placeholder="Description (optional)"
                            className="w-full text-[13px] border border-[#E3E0D9] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#D4A843]/40"
                          />
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleUpdate(item.id)}
                              disabled={saving}
                              className="bg-[#D4A843] text-[#141414] text-[13px] font-semibold px-3 py-1.5 rounded-lg hover:bg-[#C49A3A] disabled:opacity-50 transition-colors"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="bg-[#F0EDE8] text-[#141414] text-[13px] px-3 py-1.5 rounded-lg hover:bg-[#E3E0D9] transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-4">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-[14px] font-medium text-[#141414]">
                                {item.label ?? item.value}
                              </span>
                              {item.label && (
                                <span className="text-[11px] text-[#C9C5BC] font-mono">
                                  {item.value}
                                </span>
                              )}
                              {!item.isActive && (
                                <span className="bg-red-100 text-red-700 text-[10px] font-semibold px-1.5 py-0.5 rounded">
                                  Inactive
                                </span>
                              )}
                            </div>
                            {item.description && (
                              <p className="text-[12px] text-[#9E9A91] mt-0.5 truncate">
                                {item.description}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button
                              onClick={() => startEdit(item)}
                              className="text-[12px] text-[#D4A843] font-semibold hover:text-[#C49A3A] px-2 py-1 transition-colors"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleToggleActive(item)}
                              className="text-[12px] text-[#9E9A91] hover:text-[#73706A] px-2 py-1 transition-colors"
                            >
                              {item.isActive ? "Disable" : "Enable"}
                            </button>
                            <button
                              onClick={() => handleDelete(item.id)}
                              className="text-[12px] text-red-500 hover:text-red-700 px-2 py-1 transition-colors"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
