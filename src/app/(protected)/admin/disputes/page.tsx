// src/app/(protected)/admin/disputes/page.tsx
// ─── Categorised Dispute Resolution Dashboard ────────────────────────────
import Link from "next/link";
import { requirePermission } from "@/shared/auth/requirePermission";
import { adminDisputesService } from "@/modules/admin/admin-disputes.service";
import DisputeQueue from "./DisputeQueue";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Disputes — Admin" };
export const dynamic = "force-dynamic";

export default async function DisputesPage() {
  await requirePermission("VIEW_DISPUTES");

  // Fetch all tabs and stats in parallel
  const [stats, needsDecision, cooling, fraud, autoResolved, pickup, all] =
    await Promise.all([
      adminDisputesService.getQueueStats(),
      adminDisputesService.getDisputeQueue("needs_decision"),
      adminDisputesService.getDisputeQueue("cooling"),
      adminDisputesService.getDisputeQueue("fraud"),
      adminDisputesService.getDisputeQueue("auto_resolved"),
      adminDisputesService.getDisputeQueue("pickup"),
      adminDisputesService.getDisputeQueue("all"),
    ]);

  // Serialize dates for client component
  const serialize = (
    items: Awaited<ReturnType<typeof adminDisputesService.getDisputeQueue>>,
  ) =>
    items.map((d) => ({
      ...d,
      dispute: d.dispute
        ? {
            ...d.dispute,
            openedAt: d.dispute.openedAt.toISOString(),
            sellerRespondedAt:
              d.dispute.sellerRespondedAt?.toISOString() ?? null,
            resolvedAt: d.dispute.resolvedAt?.toISOString() ?? null,
          }
        : null,
      updatedAt: undefined,
    }));

  const allTabs = {
    needs_decision: serialize(needsDecision),
    cooling: serialize(cooling),
    fraud: serialize(fraud),
    auto_resolved: serialize(autoResolved),
    pickup: serialize(pickup),
    all: serialize(all),
  };

  // Determine initial tab (fraud > needs_decision > cooling > all)
  const initialTab =
    fraud.length > 0
      ? "fraud"
      : needsDecision.length > 0
        ? "needs_decision"
        : cooling.length > 0
          ? "cooling"
          : "needs_decision";

  return (
    <div className="bg-[#FAFAF8] min-h-screen">
      {/* Header */}
      <div className="bg-[#141414] text-white">
        <div className="max-w-6xl mx-auto px-6 py-8">
          <div className="flex items-center gap-2 text-[12px] text-white/40 mb-2">
            <Link href="/admin" className="hover:text-white">
              Admin
            </Link>
            <span>/</span>
            <span className="text-white">Disputes</span>
          </div>
          <div className="flex items-center gap-3 mb-1">
            <span className="text-[#D4A843] text-xl">⚖️</span>
            <h1 className="font-[family-name:var(--font-playfair)] text-[1.75rem] font-semibold">
              Dispute Resolution Centre
            </h1>
          </div>
          <p className="text-white/50 text-[13.5px]">
            {stats.totalOpen === 0
              ? "No open disputes — all clear"
              : `${stats.totalOpen} open dispute${stats.totalOpen === 1 ? "" : "s"} · ${stats.needsDecision} need${stats.needsDecision === 1 ? "s" : ""} your decision`}
          </p>
        </div>
      </div>

      {/* Queue */}
      <div className="max-w-6xl mx-auto px-6 py-8">
        <DisputeQueue
          initialTab={
            initialTab as
              | "needs_decision"
              | "cooling"
              | "fraud"
              | "auto_resolved"
              | "pickup"
              | "all"
          }
          initialItems={allTabs[initialTab as keyof typeof allTabs]}
          stats={stats}
          allTabs={
            allTabs as Record<string, (typeof allTabs)["needs_decision"]>
          }
        />
      </div>
    </div>
  );
}
