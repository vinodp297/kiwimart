// src/app/(protected)/admin/disputes/page.tsx
// ─── Disputes Admin Dashboard ─────────────────────────────────────────────────
import Link from "next/link";
import Image from "next/image";
import { requirePermission } from "@/shared/auth/requirePermission";
import db from "@/lib/db";
import { formatPrice } from "@/lib/utils";
import { getThumbUrl } from "@/lib/image";
import DisputeActionButtons from "./DisputeActionButtons";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Disputes — Admin" };
export const dynamic = "force-dynamic";

const DISPUTE_REASON_LABELS: Record<string, string> = {
  ITEM_NOT_RECEIVED: "Item not received",
  ITEM_NOT_AS_DESCRIBED: "Item not as described",
  ITEM_DAMAGED: "Item damaged",
  SELLER_UNRESPONSIVE: "Seller unresponsive",
  OTHER: "Other",
};

function daysAgo(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
}

export default async function DisputesPage() {
  await requirePermission("VIEW_DISPUTES");

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [
    disputes,
    resolvedToday,
    resolvedThisMonth,
    totalOrders,
    disputedCount,
    resolvedDisputeCount,
  ] = await Promise.all([
    db.order.findMany({
      where: { status: "DISPUTED" },
      select: {
        id: true,
        totalNzd: true,
        disputeReason: true,
        disputeNotes: true,
        disputeOpenedAt: true,
        updatedAt: true,
        listing: {
          select: {
            id: true,
            title: true,
            priceNzd: true,
            images: { where: { order: 0 }, select: { r2Key: true }, take: 1 },
          },
        },
        buyer: { select: { id: true, email: true, displayName: true } },
        seller: {
          select: {
            id: true,
            email: true,
            displayName: true,
            idVerified: true,
          },
        },
      },
      orderBy: { updatedAt: "asc" },
    }),
    db.order.count({ where: { disputeResolvedAt: { gte: todayStart } } }),
    db.order.count({ where: { disputeResolvedAt: { gte: monthStart } } }),
    db.order.count(),
    db.order.count({ where: { status: "DISPUTED" } }),
    db.order.count({ where: { status: "REFUNDED" } }),
  ]);

  // Dispute rate
  const disputeRate =
    totalOrders > 0
      ? ((disputedCount + resolvedDisputeCount) / totalOrders) * 100
      : 0;
  const rateStatus =
    disputeRate > 5 ? "critical" : disputeRate >= 2 ? "warning" : "healthy";
  const rateLabel =
    rateStatus === "critical"
      ? "Requires attention"
      : rateStatus === "warning"
        ? "Monitor closely"
        : "Healthy";
  const rateBanner = {
    critical: "bg-red-50 border-red-200 text-red-800",
    warning: "bg-amber-50 border-amber-200 text-amber-800",
    healthy: "bg-emerald-50 border-emerald-200 text-emerald-800",
  }[rateStatus];

  // Average days open
  const avgDaysOpen =
    disputes.length > 0
      ? Math.round(
          disputes.reduce(
            (sum, d) => sum + daysAgo(d.disputeOpenedAt ?? d.updatedAt),
            0,
          ) / disputes.length,
        )
      : 0;

  // Recently resolved disputes
  const resolved = await db.order.findMany({
    where: {
      disputeResolvedAt: { not: null },
      status: { in: ["COMPLETED", "REFUNDED"] },
    },
    select: {
      id: true,
      totalNzd: true,
      status: true,
      disputeResolvedAt: true,
      listing: { select: { title: true } },
      buyer: { select: { displayName: true } },
      seller: { select: { displayName: true } },
    },
    orderBy: { disputeResolvedAt: "desc" },
    take: 10,
  });

  const kpis = [
    {
      label: "Open Disputes",
      value: disputes.length.toString(),
      alert: disputes.length > 0,
    },
    { label: "Avg Days Open", value: avgDaysOpen.toString() },
    { label: "Resolved Today", value: resolvedToday.toString() },
    { label: "Resolved This Month", value: resolvedThisMonth.toString() },
  ];

  return (
    <div className="bg-[#FAFAF8] min-h-screen">
      <div className="bg-[#141414] text-white">
        <div className="max-w-5xl mx-auto px-6 py-8">
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
            {disputes.length === 0
              ? "No open disputes"
              : `${disputes.length} open dispute${disputes.length === 1 ? "" : "s"} — oldest first`}
          </p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {/* Dispute rate banner */}
        <div
          className={`border rounded-2xl px-5 py-4 text-[13.5px] font-medium ${rateBanner}`}
        >
          Dispute rate: {disputeRate.toFixed(1)}% — {rateLabel}
          <span className="ml-3 text-[12px] font-normal opacity-70">
            ({disputedCount + resolvedDisputeCount} disputed of {totalOrders}{" "}
            total orders)
          </span>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {kpis.map(({ label, value, alert }) => (
            <div
              key={label}
              className={`bg-white rounded-2xl border p-5 ${alert ? "border-red-200 bg-red-50" : "border-[#E3E0D9]"}`}
            >
              <p className="text-[12px] text-[#9E9A91] font-medium mb-1">
                {label}
              </p>
              <p className="font-[family-name:var(--font-playfair)] text-[1.75rem] font-semibold text-[#141414] leading-none">
                {value}
              </p>
            </div>
          ))}
        </div>

        {/* Empty state */}
        {disputes.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[#E3E0D9] p-16 text-center">
            <div className="text-5xl mb-4">🎉</div>
            <p className="font-[family-name:var(--font-playfair)] text-[1.25rem] font-semibold text-[#141414] mb-1">
              No open disputes
            </p>
            <p className="text-[13.5px] text-[#9E9A91]">
              All disputes have been resolved.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {disputes.map((dispute) => {
              const thumbUrl = getThumbUrl(dispute.listing.images[0]);
              const days = daysAgo(
                dispute.disputeOpenedAt ?? dispute.updatedAt,
              );
              const reasonLabel = dispute.disputeReason
                ? (DISPUTE_REASON_LABELS[dispute.disputeReason] ??
                  dispute.disputeReason)
                : null;
              return (
                <div
                  key={dispute.id}
                  className="bg-white rounded-2xl border border-[#E3E0D9] overflow-hidden"
                >
                  <div className="flex items-center gap-3 px-5 py-3 border-b border-[#F0EDE8] bg-[#FAFAF8]">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-red-50 text-red-700 border border-red-200">
                      🔴 DISPUTED
                    </span>
                    <span className="text-[12px] font-mono text-[#9E9A91]">
                      Order #{dispute.id.slice(0, 12)}…
                    </span>
                    <span className="font-semibold text-[13px] text-[#D4A843]">
                      {formatPrice(dispute.totalNzd / 100)}
                    </span>
                    <span
                      className={`ml-auto px-2 py-0.5 rounded-full text-[12px] font-semibold ${days > 7 ? "bg-red-50 text-red-700 border border-red-200" : "bg-amber-50 text-amber-700 border border-amber-100"}`}
                    >
                      {days} day{days === 1 ? "" : "s"} open
                    </span>
                  </div>
                  <div className="p-5 space-y-4">
                    <div className="flex items-center gap-3">
                      {thumbUrl ? (
                        <div className="relative w-14 h-14 rounded-xl overflow-hidden border border-[#E3E0D9] flex-shrink-0">
                          <Image
                            src={thumbUrl}
                            alt={dispute.listing.title}
                            fill
                            className="object-cover"
                            sizes="56px"
                          />
                        </div>
                      ) : (
                        <div className="w-14 h-14 rounded-xl bg-[#F8F7F4] border border-[#E3E0D9] flex-shrink-0 flex items-center justify-center text-[#C9C5BC] text-xl">
                          📦
                        </div>
                      )}
                      <div className="min-w-0">
                        <Link
                          href={`/listings/${dispute.listing.id}`}
                          className="font-semibold text-[14px] text-[#141414] hover:text-[#D4A843] transition-colors truncate block"
                        >
                          {dispute.listing.title}
                        </Link>
                        <p className="text-[13px] font-semibold text-[#D4A843]">
                          {formatPrice(dispute.listing.priceNzd / 100)}
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-[#F8F7F4] rounded-xl p-3 border border-[#E3E0D9]">
                        <p className="text-[10px] font-semibold text-[#9E9A91] uppercase tracking-wider mb-1.5">
                          Buyer
                        </p>
                        <p className="text-[13px] font-semibold text-[#141414] truncate">
                          {dispute.buyer.displayName}
                        </p>
                        <p className="text-[11.5px] text-[#73706A] truncate">
                          {dispute.buyer.email}
                        </p>
                        <Link
                          href={`/admin/users?search=${encodeURIComponent(dispute.buyer.email)}`}
                          className="text-[10.5px] text-[#D4A843] hover:underline mt-0.5 inline-block"
                        >
                          View profile →
                        </Link>
                      </div>
                      <div className="bg-[#F8F7F4] rounded-xl p-3 border border-[#E3E0D9]">
                        <p className="text-[10px] font-semibold text-[#9E9A91] uppercase tracking-wider mb-1.5">
                          Seller
                        </p>
                        <p className="text-[13px] font-semibold text-[#141414] truncate">
                          {dispute.seller.displayName}
                        </p>
                        <p className="text-[11.5px] text-[#73706A] truncate">
                          {dispute.seller.email}
                        </p>
                        {dispute.seller.idVerified && (
                          <span className="text-[10px] text-emerald-600 font-semibold">
                            ✓ ID Verified
                          </span>
                        )}
                        <Link
                          href={`/admin/users?search=${encodeURIComponent(dispute.seller.email)}`}
                          className="text-[10.5px] text-[#D4A843] hover:underline mt-0.5 block"
                        >
                          View profile →
                        </Link>
                      </div>
                    </div>
                    {(reasonLabel || dispute.disputeNotes) && (
                      <div className="bg-red-50 border border-red-100 rounded-xl p-3 space-y-1">
                        {reasonLabel && (
                          <p className="text-[12px] font-semibold text-red-800">
                            Reason: {reasonLabel}
                          </p>
                        )}
                        {dispute.disputeNotes && (
                          <p className="text-[12.5px] text-red-700 italic leading-relaxed">
                            &ldquo;{dispute.disputeNotes}&rdquo;
                          </p>
                        )}
                        {dispute.disputeOpenedAt && (
                          <p className="text-[11px] text-red-500 pt-0.5">
                            Opened{" "}
                            {dispute.disputeOpenedAt.toLocaleDateString(
                              "en-NZ",
                              {
                                day: "numeric",
                                month: "long",
                                year: "numeric",
                              },
                            )}
                          </p>
                        )}
                      </div>
                    )}
                    <DisputeActionButtons orderId={dispute.id} />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Resolved history */}
        {resolved.length > 0 && (
          <div className="bg-white rounded-2xl border border-[#E3E0D9]">
            <div className="p-5 border-b border-[#F0EDE8]">
              <h2 className="font-[family-name:var(--font-playfair)] text-[1.1rem] font-semibold text-[#141414]">
                Recently Resolved
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-[#F0EDE8] bg-[#FAFAF8]">
                    {[
                      "Order",
                      "Item",
                      "Buyer",
                      "Seller",
                      "Amount",
                      "Resolution",
                      "Resolved",
                    ].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-3 text-left text-[11px] font-semibold text-[#9E9A91] uppercase tracking-wide whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F8F7F4]">
                  {resolved.map((r) => (
                    <tr key={r.id} className="hover:bg-[#FAFAF8]">
                      <td className="px-4 py-3 font-mono text-[11px] text-[#9E9A91]">
                        {r.id.slice(0, 10)}…
                      </td>
                      <td className="px-4 py-3 text-[#141414] max-w-[140px] truncate">
                        {r.listing.title}
                      </td>
                      <td className="px-4 py-3 text-[#73706A]">
                        {r.buyer.displayName}
                      </td>
                      <td className="px-4 py-3 text-[#73706A]">
                        {r.seller.displayName}
                      </td>
                      <td className="px-4 py-3 font-semibold text-[#141414]">
                        {formatPrice(r.totalNzd / 100)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${r.status === "REFUNDED" ? "bg-emerald-50 text-emerald-700" : "bg-sky-50 text-sky-700"}`}
                        >
                          {r.status === "REFUNDED"
                            ? "Refunded Buyer"
                            : "Released to Seller"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[#9E9A91] whitespace-nowrap">
                        {r.disputeResolvedAt
                          ? new Date(r.disputeResolvedAt).toLocaleDateString(
                              "en-NZ",
                            )
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
