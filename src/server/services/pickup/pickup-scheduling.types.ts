// src/server/services/pickup/pickup-scheduling.types.ts
// ─── Shared types for the pickup scheduling service layer ────────────────────

import type db from "@/lib/db";

// ── Prisma transaction client ─────────────────────────────────────────────────

export type PrismaTransactionClient = Omit<
  typeof db,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

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
