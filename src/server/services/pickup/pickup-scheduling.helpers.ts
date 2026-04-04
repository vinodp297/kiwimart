// src/server/services/pickup/pickup-scheduling.helpers.ts
// ─── Internal helpers shared across all pickup scheduling service files ───────

import db from "@/lib/db";
import { CONFIG_KEYS, getConfigMany } from "@/lib/platform-config";
import type {
  SellerRescheduleReason,
  BuyerRescheduleReason,
} from "@prisma/client";
import type {
  PrismaTransactionClient,
  PickupProposalCard,
  PickupConfirmedCard,
  PickupRescheduleRequestCard,
  PickupRescheduleResponseCard,
} from "./pickup-scheduling.types";

// ── Config helper ─────────────────────────────────────────────────────────────

export async function getPickupConfig() {
  const cfg = await getConfigMany([
    CONFIG_KEYS.PICKUP_MIN_LEAD_TIME_HOURS,
    CONFIG_KEYS.PICKUP_MAX_HORIZON_DAYS,
    CONFIG_KEYS.PICKUP_WINDOW_MINUTES,
    CONFIG_KEYS.PICKUP_RESCHEDULE_RESPONSE_HOURS,
    CONFIG_KEYS.PICKUP_RESCHEDULE_LIMIT,
  ]);
  const minLeadHours = parseInt(
    cfg.get(CONFIG_KEYS.PICKUP_MIN_LEAD_TIME_HOURS) ?? "2",
    10,
  );
  const maxHorizonDays = parseInt(
    cfg.get(CONFIG_KEYS.PICKUP_MAX_HORIZON_DAYS) ?? "30",
    10,
  );
  const windowMinutes = parseInt(
    cfg.get(CONFIG_KEYS.PICKUP_WINDOW_MINUTES) ?? "30",
    10,
  );
  const rescheduleResponseHours = parseInt(
    cfg.get(CONFIG_KEYS.PICKUP_RESCHEDULE_RESPONSE_HOURS) ?? "12",
    10,
  );
  const rescheduleLimit = parseInt(
    cfg.get(CONFIG_KEYS.PICKUP_RESCHEDULE_LIMIT) ?? "3",
    10,
  );
  return {
    MIN_LEAD_TIME_MS: minLeadHours * 60 * 60 * 1000,
    MAX_FUTURE_MS: maxHorizonDays * 24 * 60 * 60 * 1000,
    PICKUP_WINDOW_MS: windowMinutes * 60 * 1000,
    RESCHEDULE_EXPIRY_MS: rescheduleResponseHours * 60 * 60 * 1000,
    FORCE_CANCEL_THRESHOLD: rescheduleLimit,
  };
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const TERMINAL_PICKUP_STATUSES = new Set([
  "OTP_INITIATED",
  "COMPLETED",
  "REJECTED_AT_PICKUP",
  "BUYER_NO_SHOW",
  "SELLER_NO_SHOW",
  "CANCELLED",
]);

// ── Thread helpers ────────────────────────────────────────────────────────────

/**
 * Find or create a message thread between two users for a given listing.
 * Deterministically orders participant IDs for the unique constraint.
 */
export async function findOrCreateThread(
  participant1: string,
  participant2: string,
  listingId: string | null,
  tx: PrismaTransactionClient,
): Promise<string> {
  const sorted = [participant1, participant2].sort();
  const p1 = sorted[0]!;
  const p2 = sorted[1]!;

  const existing = await tx.messageThread.findFirst({
    where: { participant1Id: p1, participant2Id: p2, listingId },
    select: { id: true },
  });

  if (existing) return existing.id;

  const thread = await tx.messageThread.create({
    data: { participant1Id: p1, participant2Id: p2, listingId },
    select: { id: true },
  });

  return thread.id;
}

/**
 * Create a system-generated pickup card message in the thread.
 */
export async function createPickupMessage(
  threadId: string,
  senderId: string,
  card:
    | PickupProposalCard
    | PickupConfirmedCard
    | PickupRescheduleRequestCard
    | PickupRescheduleResponseCard,
  tx: PrismaTransactionClient,
): Promise<void> {
  await tx.message.create({
    data: {
      threadId,
      senderId,
      body: JSON.stringify(card),
    },
  });
  await tx.messageThread.update({
    where: { id: threadId },
    data: { lastMessageAt: new Date() },
  });
}

// ── Formatting helpers ────────────────────────────────────────────────────────

export function formatPickupTime(date: Date): string {
  return date.toLocaleString("en-NZ", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Pacific/Auckland",
  });
}

/**
 * Human-readable label for a reschedule reason enum value.
 */
export function reasonLabel(
  sellerReason?: SellerRescheduleReason | null,
  buyerReason?: BuyerRescheduleReason | null,
): string {
  const raw = sellerReason ?? buyerReason ?? "OTHER";
  return raw
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
}

// re-export db for use by service files that only need transaction context
export { db };
