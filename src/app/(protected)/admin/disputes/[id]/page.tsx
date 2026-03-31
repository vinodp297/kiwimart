// src/app/(protected)/admin/disputes/[id]/page.tsx
// ─── Single-Screen Dispute Case View ─────────────────────────────────────
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/shared/auth/requirePermission";
import { adminDisputesService } from "@/modules/admin/admin-disputes.service";
import { getDisputeEvidenceUrls } from "@/server/actions/disputes";
import CaseView from "./CaseView";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await props.params;
  return { title: `Case ${id.slice(0, 8)}… — Disputes — Admin` };
}

export default async function DisputeCasePage(props: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("VIEW_DISPUTES");
  const { id } = await props.params;

  const caseData = await adminDisputesService.getCaseDetail(id);
  if (!caseData) notFound();

  // Generate signed URLs for buyer evidence photos
  const evidenceSignedUrls =
    caseData.order.disputeEvidenceUrls.length > 0
      ? await getDisputeEvidenceUrls(caseData.order.disputeEvidenceUrls)
      : [];

  // Serialize dates for client component
  const serialized = {
    order: {
      ...caseData.order,
      createdAt: caseData.order.createdAt.toISOString(),
      dispatchedAt: caseData.order.dispatchedAt?.toISOString() ?? null,
      completedAt: caseData.order.completedAt?.toISOString() ?? null,
      disputeOpenedAt: caseData.order.disputeOpenedAt?.toISOString() ?? null,
      sellerRespondedAt:
        caseData.order.sellerRespondedAt?.toISOString() ?? null,
      disputeResolvedAt:
        caseData.order.disputeResolvedAt?.toISOString() ?? null,
    },
    listing: caseData.listing,
    buyer: {
      ...caseData.buyer,
      createdAt: caseData.buyer.createdAt.toISOString(),
    },
    seller: {
      ...caseData.seller,
      createdAt: caseData.seller.createdAt.toISOString(),
    },
    timeline: caseData.timeline.map((e) => ({
      ...e,
      createdAt: e.createdAt.toISOString(),
    })),
    interactions: caseData.interactions.map((i) => ({
      ...i,
      createdAt: i.createdAt.toISOString(),
      expiresAt: i.expiresAt?.toISOString() ?? null,
    })),
    messages: caseData.messages.map((m) => ({
      ...m,
      createdAt: m.createdAt.toISOString(),
    })),
    autoResolution: caseData.autoResolution,
    inconsistencies: caseData.inconsistencies,
    counterEvidence: caseData.counterEvidence.map((ce) => ({
      ...ce,
      createdAt: ce.createdAt.toISOString(),
    })),
    evidenceSignedUrls,
  };

  return (
    <div className="bg-[#FAFAF8] min-h-screen">
      {/* Header */}
      <div className="bg-[#141414] text-white">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="flex items-center gap-2 text-[12px] text-white/40 mb-2">
            <Link href="/admin" className="hover:text-white">
              Admin
            </Link>
            <span>/</span>
            <Link href="/admin/disputes" className="hover:text-white">
              Disputes
            </Link>
            <span>/</span>
            <span className="text-white font-mono">{id.slice(0, 12)}…</span>
          </div>
          <div className="flex items-center gap-3">
            <h1 className="font-[family-name:var(--font-playfair)] text-[1.5rem] font-semibold">
              {caseData.listing.title}
            </h1>
            <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-red-500/20 text-red-300 border border-red-500/30">
              {caseData.order.status}
            </span>
            <span className="text-[13px] font-semibold text-[#D4A843]">
              {formatPrice(caseData.order.totalNzd / 100)}
            </span>
          </div>
        </div>
      </div>

      {/* Case View */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        <CaseView data={serialized} />
      </div>
    </div>
  );
}

function formatPrice(dollars: number): string {
  return new Intl.NumberFormat("en-NZ", {
    style: "currency",
    currency: "NZD",
  }).format(dollars);
}
