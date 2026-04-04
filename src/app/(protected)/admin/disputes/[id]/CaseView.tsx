"use client";
// src/app/(protected)/admin/disputes/[id]/CaseView.tsx
// ─── Single-Screen Case View (orchestration shell) ───────────────────────────

import { useRouter } from "next/navigation";
import type { CaseData } from "./components/case-view-types";
import CaseViewTimeline from "./components/CaseViewTimeline";
import CaseViewEvidence from "./components/CaseViewEvidence";
import CaseViewMessages from "./components/CaseViewMessages";
import CaseViewOrderDetails from "./components/CaseViewOrderDetails";
import CaseViewHeader from "./components/CaseViewHeader";
import CaseViewListing from "./components/CaseViewListing";
import CaseViewResolution from "./components/CaseViewResolution";

interface Props {
  data: CaseData;
}

export default function CaseView({ data }: Props) {
  const router = useRouter();
  const {
    order,
    dispute,
    listing,
    buyer,
    seller,
    autoResolution,
    inconsistencies,
  } = data;

  const isResolved = !!dispute?.resolvedAt;
  const isNotAsDescribed =
    dispute?.reason === "ITEM_NOT_AS_DESCRIBED" ||
    dispute?.reason === "ITEM_DAMAGED";

  const buyerEvidence = data.evidenceSignedItems.filter(
    (e) => e.uploadedBy === "BUYER",
  );
  const sellerEvidence = data.evidenceSignedItems.filter(
    (e) => e.uploadedBy === "SELLER",
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      {/* ── LEFT COLUMN (60%) — The Story ──────────────────────────────────── */}
      <div className="lg:col-span-3 space-y-6">
        <CaseViewTimeline
          timeline={data.timeline}
          currentStatus={order.status}
        />
        <CaseViewEvidence
          dispute={dispute}
          buyerEvidence={buyerEvidence}
          sellerEvidence={sellerEvidence}
          interactions={data.interactions}
          counterEvidence={data.counterEvidence}
        />
        {data.messages.length > 0 && (
          <CaseViewMessages messages={data.messages} />
        )}
        <CaseViewOrderDetails order={order} />
        <CaseViewListing
          snapshot={data.snapshot}
          listing={listing}
          isNotAsDescribed={isNotAsDescribed}
          dispute={dispute}
          buyerEvidence={buyerEvidence}
        />
      </div>

      {/* ── RIGHT COLUMN (40%) — Decision Tools ────────────────────────────── */}
      <div className="lg:col-span-2 space-y-6">
        <CaseViewHeader
          autoResolution={autoResolution}
          inconsistencies={inconsistencies}
          buyer={buyer}
          seller={seller}
          dispute={dispute}
        />
        <CaseViewResolution
          orderId={order.id}
          totalNzd={order.totalNzd}
          buyerId={buyer.id}
          sellerId={seller.id}
          autoResolution={autoResolution}
          dispute={dispute}
          isResolved={isResolved}
          onResolved={() => router.refresh()}
        />
      </div>
    </div>
  );
}
