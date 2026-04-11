// src/server/services/pickup/pickup-scheduling.types.ts
// ─── Shared types for the pickup scheduling service layer ────────────────────

import type { Prisma } from "@prisma/client";

// ── Prisma transaction client ─────────────────────────────────────────────────
// Use Prisma's own TransactionClient type rather than re-deriving from the db
// instance — this avoids importing @/lib/db here, which would force a runtime
// dependency on the db singleton through a pure types file and trip the
// architecture lint rule (services must go via repositories).

export type PrismaTransactionClient = Prisma.TransactionClient;

// ── Service return type ───────────────────────────────────────────────────────

export interface PickupResult {
  success: boolean;
  error?: string;
  forceCancelAvailable?: boolean;
}

// ── Pickup message card types ─────────────────────────────────────────────────

export interface PickupProposalCard {
  type: "PICKUP_PROPOSAL";
  proposedBy: "BUYER" | "SELLER";
  proposedTime: string; // ISO datetime
  location: string;
}

export interface PickupConfirmedCard {
  type: "PICKUP_CONFIRMED";
  confirmedTime: string; // ISO datetime
  location: string;
}

export interface PickupRescheduleRequestCard {
  type: "PICKUP_RESCHEDULE_REQUEST";
  requestedBy: "BUYER" | "SELLER";
  reason: string;
  reasonNote: string | null;
  proposedTime: string; // ISO datetime
  requestId: string;
}

export interface PickupRescheduleResponseCard {
  type: "PICKUP_RESCHEDULE_RESPONSE";
  response: "ACCEPTED" | "REJECTED";
  respondedBy: "BUYER" | "SELLER";
  originalTime: string; // ISO datetime
  newTime: string | null; // ISO datetime if accepted
}
