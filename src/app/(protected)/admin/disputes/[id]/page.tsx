// src/app/(protected)/admin/disputes/[id]/page.tsx
// ─── Single-Screen Dispute Case View ─────────────────────────────────────
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/shared/auth/requirePermission";
import { adminDisputesService } from "@/modules/admin/admin-disputes.service";
import { getSignedEvidenceFromRecords } from "@/server/actions/disputes";
import { markUnderReview } from "@/server/services/dispute/dispute.service";
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

  // Generate signed URLs for evidence photos from Dispute model
  const evidenceSignedItems =
    caseData.dispute?.evidence && caseData.dispute.evidence.length > 0
      ? await getSignedEvidenceFromRecords(caseData.dispute.evidence)
      : [];

  // Mark dispute as under review when admin opens the case
  if (caseData.dispute) {
    markUnderReview(caseData.dispute.id).catch(() => {});
  }

  // Serialize dates for client component
  const serialized = {
    order: {
      ...caseData.order,
      createdAt: caseData.order.createdAt.toISOString(),
      dispatchedAt: caseData.order.dispatchedAt?.toISOString() ?? null,
      completedAt: caseData.order.completedAt?.toISOString() ?? null,
      fulfillmentType: caseData.order.fulfillmentType,
      pickupStatus: caseData.order.pickupStatus,
      pickupScheduledAt:
        caseData.order.pickupScheduledAt?.toISOString() ?? null,
      otpInitiatedAt: caseData.order.otpInitiatedAt?.toISOString() ?? null,
      pickupConfirmedAt:
        caseData.order.pickupConfirmedAt?.toISOString() ?? null,
      pickupRejectedAt: caseData.order.pickupRejectedAt?.toISOString() ?? null,
      rescheduleCount: caseData.order.rescheduleCount,
      pickupRescheduleRequests: caseData.order.pickupRescheduleRequests.map(
        (req) => ({
          ...req,
          proposedTime: req.proposedTime.toISOString(),
          respondedAt: req.respondedAt?.toISOString() ?? null,
          createdAt: req.createdAt.toISOString(),
        }),
      ),
    },
    dispute: caseData.dispute
      ? {
          ...caseData.dispute,
          openedAt: caseData.dispute.openedAt.toISOString(),
          sellerRespondedAt:
            caseData.dispute.sellerRespondedAt?.toISOString() ?? null,
          resolvedAt: caseData.dispute.resolvedAt?.toISOString() ?? null,
          evidence: caseData.dispute.evidence.map((e) => ({
            ...e,
            createdAt: e.createdAt.toISOString(),
          })),
        }
      : null,
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
    evidenceSignedItems,
    snapshot: caseData.snapshot
      ? {
          ...caseData.snapshot,
          capturedAt: caseData.snapshot.capturedAt.toISOString(),
        }
      : null,
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
