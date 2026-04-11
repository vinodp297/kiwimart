// src/app/(protected)/admin/disputes/[id]/components/case-view-types.ts
// ─── Shared types, constants, and utilities for CaseView ─────────────────────

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SnapshotImage {
  r2Key: string;
  thumbnailKey: string | null;
  order: number;
}

export interface SnapshotAttribute {
  label: string;
  value: string;
  order: number;
}

export interface ListingSnapshotData {
  title: string;
  description: string;
  condition: string;
  priceNzd: number;
  shippingNzd: number;
  categoryName: string;
  subcategoryName: string | null;
  shippingOption: string;
  isNegotiable: boolean;
  // Json fields — Prisma returns these as unknown; cast inside the component
  images: unknown;
  attributes: unknown;
  capturedAt: string;
}

export interface AutoResolution {
  decision: string;
  score: number;
  recommendation: string;
  status: string;
  executeAt: string | null;
  factors: Array<{ factor: string; points: number; description: string }>;
}

export interface Inconsistency {
  type: "warning" | "alert";
  message: string;
  severity: "low" | "medium" | "high";
}

export interface TimelineEvent {
  id: string;
  type: string;
  actorRole: string;
  summary: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  actor: { displayName: string | null; username: string } | null;
}

export interface EvidenceItem {
  id: string;
  url: string;
  uploadedBy: string;
  label: string | null;
  createdAt: string;
}

export interface DisputeData {
  id: string;
  reason: string;
  status: string;
  source: string;
  buyerStatement: string | null;
  sellerStatement: string | null;
  adminNotes: string | null;
  resolution: string | null;
  refundAmount: number | null;
  autoResolutionScore: number | null;
  autoResolutionReason: string | null;
  openedAt: string;
  sellerRespondedAt: string | null;
  resolvedAt: string | null;
  evidence: Array<{
    id: string;
    r2Key: string;
    uploadedBy: string;
    label: string | null;
    createdAt: string;
  }>;
}

export interface CaseData {
  order: {
    id: string;
    totalNzd: number;
    status: string;
    createdAt: string;
    dispatchedAt: string | null;
    completedAt: string | null;
    trackingNumber: string | null;
    stripePaymentIntentId: string | null;
    // Pickup fields
    fulfillmentType?: string;
    pickupStatus?: string | null;
    pickupScheduledAt?: string | null;
    otpInitiatedAt?: string | null;
    pickupConfirmedAt?: string | null;
    pickupRejectedAt?: string | null;
    rescheduleCount?: number;
    pickupRescheduleRequests?: Array<{
      id: string;
      requestedByRole: string;
      sellerReason: string | null;
      buyerReason: string | null;
      reasonNote: string | null;
      proposedTime: string;
      status: string;
      responseNote: string | null;
      respondedAt: string | null;
      createdAt: string;
      requestedBy: { displayName: string | null };
    }>;
  };
  dispute: DisputeData | null;
  listing: {
    id: string;
    title: string;
    description: string;
    condition: string | null;
    priceNzd: number;
    images: { r2Key: string; thumbnailKey: string | null }[];
  };
  buyer: {
    id: string;
    email: string;
    displayName: string;
    createdAt: string;
    metrics: {
      totalOrders: number;
      completedOrders: number;
      disputeCount: number;
      disputeRate: number;
      disputesLast30Days: number;
      accountAgeDays: number;
      isFlaggedForFraud: boolean;
    };
  };
  seller: {
    id: string;
    email: string;
    displayName: string;
    idVerified: boolean;
    nzbn: string | null;
    isGstRegistered: boolean;
    createdAt: string;
    metrics: {
      totalOrders: number;
      completedOrders: number;
      disputeCount: number;
      disputeRate: number;
      averageResponseHours: number | null;
      averageRating: number | null;
      dispatchPhotoRate: number;
      accountAgeDays: number;
      isFlaggedForFraud: boolean;
    };
  };
  timeline: TimelineEvent[];
  interactions: Array<{
    id: string;
    type: string;
    status: string;
    reason: string | null;
    responseNote: string | null;
    createdAt: string;
    expiresAt: string | null;
    initiatedBy: { displayName: string } | null;
    responseBy: { displayName: string } | null;
  }>;
  messages: Array<{
    id: string;
    content: string;
    createdAt: string;
    sender: { displayName: string } | null;
  }>;
  autoResolution: AutoResolution | null;
  inconsistencies: Inconsistency[];
  snapshot: ListingSnapshotData | null;
  counterEvidence: Array<{
    id: string;
    actorRole: string;
    summary: string;
    metadata: Record<string, unknown> | null;
    createdAt: string;
    actor: { displayName: string | null } | null;
  }>;
  evidenceSignedItems: EvidenceItem[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const CONDITION_LABELS: Record<string, string> = {
  NEW: "Brand new",
  LIKE_NEW: "Like new",
  GOOD: "Good",
  FAIR: "Fair",
  PARTS: "Parts only",
};

export const SHIPPING_LABELS: Record<string, string> = {
  PICKUP: "Pickup only",
  COURIER: "Courier",
  BOTH: "Pickup or courier",
};

export const REASON_LABELS: Record<string, string> = {
  ITEM_NOT_RECEIVED: "Item not received",
  ITEM_NOT_AS_DESCRIBED: "Item not as described",
  ITEM_DAMAGED: "Item damaged",
  WRONG_ITEM_SENT: "Wrong item sent",
  COUNTERFEIT_ITEM: "Counterfeit item",
  SELLER_UNRESPONSIVE: "Seller unresponsive",
  SELLER_CANCELLED: "Seller cancelled",
  REFUND_NOT_PROCESSED: "Refund not processed",
  OTHER: "Other",
};

export const SOP: Record<string, string> = {
  ITEM_NOT_RECEIVED:
    "Check tracking status. If tracking shows delivered, dismiss. If no tracking or no movement, refund buyer.",
  ITEM_NOT_AS_DESCRIBED:
    "Compare buyer's photos/description with original listing. If listing is materially misleading, refund buyer. If minor discrepancy, consider partial refund.",
  ITEM_DAMAGED:
    "Compare buyer's photos with seller's dispatch photos (if available). If damage is clear and not present in dispatch photos, refund buyer. If both have photos, consider partial refund.",
  WRONG_ITEM_SENT:
    "Check tracking and dispatch photos. If the wrong item was clearly sent, refund buyer.",
  OTHER:
    "Change of mind is not covered under buyer protection for private sellers. Direct buyer to return request flow. Under NZ Consumer Guarantees Act, private sellers are not obligated to accept change-of-mind returns.",
};

// ── Utility functions ─────────────────────────────────────────────────────────

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-NZ", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-NZ", { day: "numeric", month: "short" })}, ${d.toLocaleTimeString("en-NZ", { hour: "numeric", minute: "2-digit", hour12: true }).toLowerCase()}`;
}

export function hoursSince(iso: string | null): number {
  if (!iso) return 0;
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60));
}
