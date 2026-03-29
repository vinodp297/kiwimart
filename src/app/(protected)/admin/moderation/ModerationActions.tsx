"use client";
// src/app/(protected)/admin/moderation/ModerationActions.tsx

import { useState } from "react";
import { useRouter } from "next/navigation";
import { resolveReport } from "@/server/actions/admin";
import { unbanUser } from "@/server/actions/admin";

interface Props {
  reportId: string | null;
  hasListing: boolean;
  hasTargetUser: boolean;
  targetAlreadyBanned: boolean;
  unbanUserId?: string;
}

export default function ModerationActions({
  reportId,
  hasListing,
  hasTargetUser,
  targetAlreadyBanned,
  unbanUserId,
}: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function handleAction(action: "dismiss" | "remove" | "ban") {
    if (!reportId) return;
    setLoading(action);
    setError("");
    const result = await resolveReport(reportId, action);
    if (!result.success)
      setError(result.error ?? "The ban action failed. Please try again.");
    else {
      setDone(true);
      router.refresh();
    }
    setLoading(null);
  }

  async function handleUnban() {
    if (!unbanUserId) return;
    setLoading("unban");
    setError("");
    const result = await unbanUser(unbanUserId);
    if (!result.success)
      setError(result.error ?? "The unban action failed. Please try again.");
    else {
      setDone(true);
      router.refresh();
    }
    setLoading(null);
  }

  if (done)
    return (
      <span className="text-[11px] text-emerald-600 font-semibold">✓ Done</span>
    );

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {error && <span className="text-[11px] text-red-600">{error}</span>}
      {unbanUserId ? (
        <button
          onClick={handleUnban}
          disabled={loading === "unban"}
          className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors disabled:opacity-50"
        >
          {loading === "unban" ? "…" : "Unban"}
        </button>
      ) : (
        <>
          <button
            onClick={() => handleAction("dismiss")}
            disabled={!!loading}
            className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-[#F8F7F4] text-[#73706A] hover:bg-[#E3E0D9] transition-colors disabled:opacity-50"
          >
            {loading === "dismiss" ? "…" : "Dismiss"}
          </button>
          {hasListing && (
            <button
              onClick={() => handleAction("remove")}
              disabled={!!loading}
              className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors disabled:opacity-50"
            >
              {loading === "remove" ? "…" : "Remove listing"}
            </button>
          )}
          {hasTargetUser && !targetAlreadyBanned && (
            <button
              onClick={() => handleAction("ban")}
              disabled={!!loading}
              className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-red-50 text-red-700 hover:bg-red-100 transition-colors disabled:opacity-50"
            >
              {loading === "ban" ? "…" : "Ban user"}
            </button>
          )}
        </>
      )}
    </div>
  );
}
