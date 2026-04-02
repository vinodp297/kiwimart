// src/server/services/pickup/pickup-scheduling.service.ts
// ─── Pickup Scheduling Service ──────────────────────────────────────────────
// Manages the pickup lifecycle: propose, accept, reschedule, respond, cancel.
// OTP generation, SMS, and BullMQ job processors are NOT built here (Prompt B).

import db from "@/lib/db";
import { CONFIG_KEYS, getConfigMany } from "@/lib/platform-config";
import { logger } from "@/shared/logger";
import { audit } from "@/server/lib/audit";
import { createNotification } from "@/modules/notifications/notification.service";
import { transitionOrder } from "@/modules/orders/order.transitions";
import { paymentService } from "@/modules/payments/payment.service";
import {
  orderEventService,
  ORDER_EVENT_TYPES,
  ACTOR_ROLES,
} from "@/modules/orders/order-event.service";
import { pickupQueue } from "@/lib/queue";
import type {
  SellerRescheduleReason,
  BuyerRescheduleReason,
} from "@prisma/client";

// ── Types ────────────────────────────────────────────────────────────────────

type PrismaTransactionClient = Omit<
  typeof db,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export interface PickupResult {
  success: boolean;
  error?: string;
  forceCancelAvailable?: boolean;
}

// ── Pickup message card types ────────────────────────────────────────────────

interface PickupProposalCard {
  type: "PICKUP_PROPOSAL";
  proposedBy: "BUYER" | "SELLER";
  proposedTime: string; // ISO datetime
  location: string;
}

interface PickupConfirmedCard {
  type: "PICKUP_CONFIRMED";
  confirmedTime: string; // ISO datetime
  location: string;
}

interface PickupRescheduleRequestCard {
  type: "PICKUP_RESCHEDULE_REQUEST";
  requestedBy: "BUYER" | "SELLER";
  reason: string;
  reasonNote: string | null;
  proposedTime: string; // ISO datetime
  requestId: string;
}

interface PickupRescheduleResponseCard {
  type: "PICKUP_RESCHEDULE_RESPONSE";
  response: "ACCEPTED" | "REJECTED";
  respondedBy: "BUYER" | "SELLER";
  originalTime: string; // ISO datetime
  newTime: string | null; // ISO datetime if accepted
}

// ── Config helper ────────────────────────────────────────────────────────────

async function getPickupConfig() {
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

// ── Helpers ──────────────────────────────────────────────────────────────────

const TERMINAL_PICKUP_STATUSES = new Set([
  "OTP_INITIATED",
  "COMPLETED",
  "REJECTED_AT_PICKUP",
  "BUYER_NO_SHOW",
  "SELLER_NO_SHOW",
  "CANCELLED",
]);

/**
 * Find or create a message thread between two users for a given listing.
 * Deterministically orders participant IDs for the unique constraint.
 */
async function findOrCreateThread(
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
async function createPickupMessage(
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

function formatPickupTime(date: Date): string {
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
function reasonLabel(
  sellerReason?: SellerRescheduleReason | null,
  buyerReason?: BuyerRescheduleReason | null,
): string {
  const raw = sellerReason ?? buyerReason ?? "OTHER";
  return raw
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
}

// ── proposePickupTime ────────────────────────────────────────────────────────

export async function proposePickupTime(params: {
  orderId: string;
  proposedById: string;
  proposedByRole: "BUYER" | "SELLER";
  proposedTime: Date;
}): Promise<PickupResult> {
  const { orderId, proposedById, proposedByRole, proposedTime } = params;

  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      buyerId: true,
      sellerId: true,
      status: true,
      fulfillmentType: true,
      pickupStatus: true,
      listingId: true,
      listing: { select: { title: true, pickupAddress: true } },
    },
  });

  if (!order) return { success: false, error: "Order not found." };

  if (
    order.fulfillmentType !== "ONLINE_PAYMENT_PICKUP" &&
    order.fulfillmentType !== "CASH_ON_PICKUP"
  ) {
    return { success: false, error: "This order is not a pickup order." };
  }

  if (order.status !== "AWAITING_PICKUP") {
    return {
      success: false,
      error: "Order is not in a pickup-eligible state.",
    };
  }

  // Validate pickupStatus allows proposals
  const allowedStatuses = new Set([
    "AWAITING_SCHEDULE",
    "SCHEDULING",
    "RESCHEDULING",
  ]);
  if (order.pickupStatus && !allowedStatuses.has(order.pickupStatus)) {
    return {
      success: false,
      error: "Pickup time cannot be proposed at this stage.",
    };
  }

  // Validate proposer is a party to this order
  if (proposedById !== order.buyerId && proposedById !== order.sellerId) {
    return { success: false, error: "You are not a party to this order." };
  }

  // Validate time: at least minimum lead time in the future
  const pickupCfg = await getPickupConfig();
  const now = Date.now();
  if (proposedTime.getTime() - now < pickupCfg.MIN_LEAD_TIME_MS) {
    return {
      success: false,
      error: "Proposed time must be at least 2 hours in the future.",
    };
  }

  // Validate time: not more than max horizon in the future
  if (proposedTime.getTime() - now > pickupCfg.MAX_FUTURE_MS) {
    return {
      success: false,
      error: "Proposed time cannot be more than 30 days in the future.",
    };
  }

  const otherPartyId =
    proposedById === order.buyerId ? order.sellerId : order.buyerId;
  const location =
    order.listing.pickupAddress ?? "Pickup location (see listing)";

  await db.$transaction(async (tx) => {
    // Update pickup status to SCHEDULING
    await tx.order.update({
      where: { id: orderId },
      data: { pickupStatus: "SCHEDULING" },
    });

    // Create pickup proposal message in thread
    const threadId = await findOrCreateThread(
      order.buyerId,
      order.sellerId,
      order.listingId,
      tx,
    );

    const card: PickupProposalCard = {
      type: "PICKUP_PROPOSAL",
      proposedBy: proposedByRole,
      proposedTime: proposedTime.toISOString(),
      location,
    };

    await createPickupMessage(threadId, proposedById, card, tx);
  });

  // Notifications (fire-and-forget)
  const roleLabel = proposedByRole === "BUYER" ? "buyer" : "seller";
  const timeLabel = formatPickupTime(proposedTime);

  createNotification({
    userId: otherPartyId,
    type: "SYSTEM",
    title: "Pickup time proposed",
    body: `The ${roleLabel} proposed pickup for "${order.listing.title}" on ${timeLabel}. Accept or suggest another time.`,
    orderId,
    link: `/orders/${orderId}`,
  }).catch(() => {});

  orderEventService.recordEvent({
    orderId,
    type: ORDER_EVENT_TYPES.ORDER_CREATED, // Reuse — no custom pickup event type needed
    actorId: proposedById,
    actorRole:
      proposedByRole === "BUYER" ? ACTOR_ROLES.BUYER : ACTOR_ROLES.SELLER,
    summary: `${proposedByRole === "BUYER" ? "Buyer" : "Seller"} proposed pickup on ${timeLabel}`,
    metadata: {
      proposedTime: proposedTime.toISOString(),
      action: "PICKUP_PROPOSED",
    },
  });

  logger.info("pickup.proposed", {
    orderId,
    proposedById,
    proposedTime: proposedTime.toISOString(),
  });

  return { success: true };
}

// ── acceptPickupTime ─────────────────────────────────────────────────────────

export async function acceptPickupTime(params: {
  orderId: string;
  acceptedById: string;
  rescheduleRequestId?: string;
}): Promise<PickupResult> {
  const { orderId, acceptedById, rescheduleRequestId } = params;
  const pickupCfg = await getPickupConfig();

  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      buyerId: true,
      sellerId: true,
      status: true,
      fulfillmentType: true,
      pickupStatus: true,
      listingId: true,
      listing: { select: { title: true, pickupAddress: true } },
    },
  });

  if (!order) return { success: false, error: "Order not found." };

  if (order.status !== "AWAITING_PICKUP") {
    return {
      success: false,
      error: "Order is not in a pickup-eligible state.",
    };
  }

  // Validate acceptor is a party
  if (acceptedById !== order.buyerId && acceptedById !== order.sellerId) {
    return { success: false, error: "You are not a party to this order." };
  }

  let confirmedTime: Date;

  if (rescheduleRequestId) {
    // Accept a specific reschedule request
    const request = await db.pickupRescheduleRequest.findUnique({
      where: { id: rescheduleRequestId },
      select: {
        id: true,
        orderId: true,
        requestedById: true,
        proposedTime: true,
        status: true,
      },
    });

    if (!request)
      return { success: false, error: "Reschedule request not found." };
    if (request.orderId !== orderId)
      return {
        success: false,
        error: "Request does not belong to this order.",
      };
    if (request.status !== "PENDING")
      return {
        success: false,
        error: "This request has already been responded to.",
      };
    if (request.requestedById === acceptedById) {
      return { success: false, error: "You cannot accept your own proposal." };
    }

    confirmedTime = request.proposedTime;

    await db.pickupRescheduleRequest.update({
      where: { id: rescheduleRequestId },
      data: { status: "ACCEPTED", respondedAt: new Date() },
    });
  } else {
    // Accept the most recent proposal from the message thread
    // Find the latest PICKUP_PROPOSAL message
    const [p1, p2] = [order.buyerId, order.sellerId].sort();
    const thread = await db.messageThread.findFirst({
      where: {
        participant1Id: p1,
        participant2Id: p2,
        listingId: order.listingId,
      },
      select: { id: true },
    });

    if (!thread) return { success: false, error: "No pickup proposal found." };

    const recentMessages = await db.message.findMany({
      where: { threadId: thread.id },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { body: true, senderId: true },
    });

    let proposalCard: PickupProposalCard | null = null;
    for (const msg of recentMessages) {
      if (msg.body.startsWith('{"type":"PICKUP_PROPOSAL"')) {
        try {
          const parsed = JSON.parse(msg.body) as PickupProposalCard;
          if (parsed.type === "PICKUP_PROPOSAL") {
            // Ensure the acceptor is NOT the proposer
            if (msg.senderId === acceptedById) continue;
            proposalCard = parsed;
            break;
          }
        } catch {
          /* not a valid card */
        }
      }
    }

    if (!proposalCard) {
      return { success: false, error: "No pickup proposal found to accept." };
    }

    confirmedTime = new Date(proposalCard.proposedTime);
  }

  const location =
    order.listing.pickupAddress ?? "Pickup location (see listing)";

  await db.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: orderId },
      data: {
        pickupStatus: "SCHEDULED",
        pickupScheduledAt: confirmedTime,
        pickupWindowExpiresAt: new Date(
          confirmedTime.getTime() + pickupCfg.PICKUP_WINDOW_MS,
        ),
      },
    });

    // Create confirmation message in thread
    const threadId = await findOrCreateThread(
      order.buyerId,
      order.sellerId,
      order.listingId,
      tx,
    );

    const card: PickupConfirmedCard = {
      type: "PICKUP_CONFIRMED",
      confirmedTime: confirmedTime.toISOString(),
      location,
    };

    await createPickupMessage(threadId, acceptedById, card, tx);
  });

  // Schedule PICKUP_WINDOW_EXPIRED job
  const windowDelay =
    new Date(confirmedTime.getTime() + pickupCfg.PICKUP_WINDOW_MS).getTime() -
    Date.now();
  const windowJobId = `pickup-window-${orderId}`;
  pickupQueue
    .add(
      "PICKUP_JOB",
      { type: "PICKUP_WINDOW_EXPIRED" as const, orderId },
      { delay: Math.max(windowDelay, 0), jobId: windowJobId },
    )
    .then(() => {
      db.order
        .update({
          where: { id: orderId },
          data: { pickupWindowJobId: windowJobId },
        })
        .catch(() => {});
    })
    .catch((err) => {
      logger.warn("pickup.window_job.schedule_failed", {
        orderId,
        error: err instanceof Error ? err.message : String(err),
      });
    });

  const timeLabel = formatPickupTime(confirmedTime);

  // Notify both parties
  createNotification({
    userId: order.buyerId,
    type: "SYSTEM",
    title: "Pickup time confirmed",
    body: `Pickup for "${order.listing.title}" confirmed: ${timeLabel}`,
    orderId,
    link: `/orders/${orderId}`,
  }).catch(() => {});

  createNotification({
    userId: order.sellerId,
    type: "SYSTEM",
    title: "Pickup time confirmed",
    body: `Pickup for "${order.listing.title}" confirmed: ${timeLabel}`,
    orderId,
    link: `/orders/${orderId}`,
  }).catch(() => {});

  orderEventService.recordEvent({
    orderId,
    type: ORDER_EVENT_TYPES.ORDER_CREATED,
    actorId: acceptedById,
    actorRole:
      acceptedById === order.buyerId ? ACTOR_ROLES.BUYER : ACTOR_ROLES.SELLER,
    summary: `Pickup confirmed for ${timeLabel}`,
    metadata: {
      confirmedTime: confirmedTime.toISOString(),
      action: "PICKUP_CONFIRMED",
    },
  });

  logger.info("pickup.accepted", {
    orderId,
    acceptedById,
    confirmedTime: confirmedTime.toISOString(),
  });

  return { success: true };
}

// ── requestReschedule ────────────────────────────────────────────────────────

export async function requestReschedule(params: {
  orderId: string;
  requestedById: string;
  requestedByRole: "BUYER" | "SELLER";
  sellerReason?: SellerRescheduleReason;
  buyerReason?: BuyerRescheduleReason;
  reasonNote?: string;
  proposedTime: Date;
}): Promise<PickupResult> {
  const {
    orderId,
    requestedById,
    requestedByRole,
    sellerReason,
    buyerReason,
    reasonNote,
    proposedTime,
  } = params;
  const pickupCfg = await getPickupConfig();

  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      buyerId: true,
      sellerId: true,
      status: true,
      fulfillmentType: true,
      pickupStatus: true,
      pickupScheduledAt: true,
      rescheduleCount: true,
      listingId: true,
      listing: { select: { title: true, pickupAddress: true } },
    },
  });

  if (!order) return { success: false, error: "Order not found." };

  if (order.status !== "AWAITING_PICKUP") {
    return {
      success: false,
      error: "Order is not in a pickup-eligible state.",
    };
  }

  // Must be SCHEDULED to reschedule
  if (order.pickupStatus !== "SCHEDULED") {
    return {
      success: false,
      error: "Can only reschedule a confirmed pickup time.",
    };
  }

  // Validate party
  if (requestedById !== order.buyerId && requestedById !== order.sellerId) {
    return { success: false, error: "You are not a party to this order." };
  }

  // Validate time: at least 2 hours in future
  const now = Date.now();
  if (proposedTime.getTime() - now < pickupCfg.MIN_LEAD_TIME_MS) {
    return {
      success: false,
      error: "Proposed time must be at least 2 hours in the future.",
    };
  }

  if (proposedTime.getTime() - now > pickupCfg.MAX_FUTURE_MS) {
    return {
      success: false,
      error: "Proposed time cannot be more than 30 days in the future.",
    };
  }

  // Validate reason based on role
  if (requestedByRole === "SELLER" && !sellerReason) {
    return {
      success: false,
      error: "Please select a reason for rescheduling.",
    };
  }
  if (requestedByRole === "BUYER" && !buyerReason) {
    return {
      success: false,
      error: "Please select a reason for rescheduling.",
    };
  }

  // If reason is OTHER, reasonNote is required (min 20 chars)
  const isOther =
    (requestedByRole === "SELLER" && sellerReason === "OTHER") ||
    (requestedByRole === "BUYER" && buyerReason === "OTHER");
  if (isOther && (!reasonNote || reasonNote.trim().length < 20)) {
    return {
      success: false,
      error: "Please provide a genuine reason (at least 20 characters).",
    };
  }

  const newRescheduleCount = order.rescheduleCount + 1;
  const otherPartyId =
    requestedById === order.buyerId ? order.sellerId : order.buyerId;

  let requestId: string;

  await db.$transaction(async (tx) => {
    // Increment reschedule count and set status to RESCHEDULING
    await tx.order.update({
      where: { id: orderId },
      data: {
        pickupStatus: "RESCHEDULING",
        rescheduleCount: newRescheduleCount,
        pickupWindowJobId: null,
      },
    });

    // Create PickupRescheduleRequest
    const request = await tx.pickupRescheduleRequest.create({
      data: {
        orderId,
        requestedById,
        requestedByRole,
        sellerReason: sellerReason ?? null,
        buyerReason: buyerReason ?? null,
        reasonNote: reasonNote ?? null,
        proposedTime,
        expiresAt: new Date(Date.now() + pickupCfg.RESCHEDULE_EXPIRY_MS),
      },
      select: { id: true },
    });

    requestId = request.id;

    // Create reschedule request message in thread
    const threadId = await findOrCreateThread(
      order.buyerId,
      order.sellerId,
      order.listingId,
      tx,
    );

    const card: PickupRescheduleRequestCard = {
      type: "PICKUP_RESCHEDULE_REQUEST",
      requestedBy: requestedByRole,
      reason: reasonLabel(sellerReason, buyerReason),
      reasonNote: reasonNote ?? null,
      proposedTime: proposedTime.toISOString(),
      requestId: request.id,
    };

    await createPickupMessage(threadId, requestedById, card, tx);
  });

  // Cancel existing pickup window job
  if (order.pickupScheduledAt) {
    const oldWindowJobId = `pickup-window-${orderId}`;
    pickupQueue.remove(oldWindowJobId).catch(() => {});
  }

  // Schedule RESCHEDULE_RESPONSE_EXPIRED job (12 hours)
  const rescheduleJobId = `reschedule-expired-${orderId}-${requestId!}`;
  pickupQueue
    .add(
      "PICKUP_JOB",
      {
        type: "RESCHEDULE_RESPONSE_EXPIRED" as const,
        orderId,
        rescheduleRequestId: requestId!,
      },
      { delay: pickupCfg.RESCHEDULE_EXPIRY_MS, jobId: rescheduleJobId },
    )
    .then(() => {
      db.pickupRescheduleRequest
        .update({
          where: { id: requestId! },
          data: { rescheduleJobId },
        })
        .catch(() => {});
    })
    .catch((err) => {
      logger.warn("pickup.reschedule_job.schedule_failed", {
        orderId,
        error: err instanceof Error ? err.message : String(err),
      });
    });

  const label = requestedByRole === "BUYER" ? "buyer" : "seller";
  const timeLabel = formatPickupTime(proposedTime);
  const reasonText = reasonLabel(sellerReason, buyerReason);

  createNotification({
    userId: otherPartyId,
    type: "SYSTEM",
    title: "Pickup reschedule requested",
    body: `The ${label} would like to reschedule pickup for "${order.listing.title}" to ${timeLabel}. Reason: ${reasonText}`,
    orderId,
    link: `/orders/${orderId}`,
  }).catch(() => {});

  orderEventService.recordEvent({
    orderId,
    type: ORDER_EVENT_TYPES.ORDER_CREATED,
    actorId: requestedById,
    actorRole:
      requestedByRole === "BUYER" ? ACTOR_ROLES.BUYER : ACTOR_ROLES.SELLER,
    summary: `${requestedByRole === "BUYER" ? "Buyer" : "Seller"} requested reschedule to ${timeLabel}: ${reasonText}`,
    metadata: {
      action: "PICKUP_RESCHEDULE_REQUESTED",
      proposedTime: proposedTime.toISOString(),
      rescheduleCount: newRescheduleCount,
      reason: reasonText,
    },
  });

  logger.info("pickup.reschedule.requested", {
    orderId,
    requestedById,
    proposedTime: proposedTime.toISOString(),
    rescheduleCount: newRescheduleCount,
  });

  // Force-cancel check: if rescheduleCount >= threshold, flag it
  if (newRescheduleCount >= pickupCfg.FORCE_CANCEL_THRESHOLD) {
    return { success: true, forceCancelAvailable: true };
  }

  return { success: true };
}

// ── respondToReschedule ──────────────────────────────────────────────────────

export async function respondToReschedule(params: {
  orderId: string;
  rescheduleRequestId: string;
  respondedById: string;
  response: "ACCEPT" | "REJECT" | "PROPOSE_ALTERNATIVE";
  alternativeTime?: Date;
  responseNote?: string;
}): Promise<PickupResult> {
  const {
    orderId,
    rescheduleRequestId,
    respondedById,
    response,
    alternativeTime,
    responseNote,
  } = params;
  const pickupCfg = await getPickupConfig();

  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      buyerId: true,
      sellerId: true,
      status: true,
      pickupStatus: true,
      pickupScheduledAt: true,
      listingId: true,
      listing: { select: { title: true, pickupAddress: true } },
    },
  });

  if (!order) return { success: false, error: "Order not found." };

  // Validate responder is a party
  if (respondedById !== order.buyerId && respondedById !== order.sellerId) {
    return { success: false, error: "You are not a party to this order." };
  }

  const request = await db.pickupRescheduleRequest.findUnique({
    where: { id: rescheduleRequestId },
    select: {
      id: true,
      orderId: true,
      requestedById: true,
      requestedByRole: true,
      proposedTime: true,
      status: true,
      expiresAt: true,
    },
  });

  if (!request)
    return { success: false, error: "Reschedule request not found." };
  if (request.orderId !== orderId)
    return { success: false, error: "Request does not belong to this order." };

  // Cannot respond to own request
  if (request.requestedById === respondedById) {
    return {
      success: false,
      error: "You cannot respond to your own reschedule request.",
    };
  }

  if (request.status !== "PENDING") {
    return {
      success: false,
      error: "This request has already been responded to.",
    };
  }

  if (request.expiresAt < new Date()) {
    return { success: false, error: "This reschedule request has expired." };
  }

  const respondedByRole: "BUYER" | "SELLER" =
    respondedById === order.buyerId ? "BUYER" : "SELLER";

  if (response === "ACCEPT") {
    // Accept the reschedule — delegate to acceptPickupTime
    await db.pickupRescheduleRequest.update({
      where: { id: rescheduleRequestId },
      data: {
        status: "ACCEPTED",
        respondedAt: new Date(),
        responseNote: responseNote ?? null,
      },
    });

    // Create response card in thread
    await db.$transaction(async (tx) => {
      const threadId = await findOrCreateThread(
        order.buyerId,
        order.sellerId,
        order.listingId,
        tx,
      );

      const card: PickupRescheduleResponseCard = {
        type: "PICKUP_RESCHEDULE_RESPONSE",
        response: "ACCEPTED",
        respondedBy: respondedByRole,
        originalTime: order.pickupScheduledAt?.toISOString() ?? "",
        newTime: request.proposedTime.toISOString(),
      };

      await createPickupMessage(threadId, respondedById, card, tx);

      // Update order to SCHEDULED with new time
      await tx.order.update({
        where: { id: orderId },
        data: {
          pickupStatus: "SCHEDULED",
          pickupScheduledAt: request.proposedTime,
          pickupWindowExpiresAt: new Date(
            request.proposedTime.getTime() + pickupCfg.PICKUP_WINDOW_MS,
          ),
        },
      });
    });

    const timeLabel = formatPickupTime(request.proposedTime);

    // Notify both parties
    createNotification({
      userId: order.buyerId,
      type: "SYSTEM",
      title: "Pickup rescheduled",
      body: `Pickup for "${order.listing.title}" confirmed: ${timeLabel}`,
      orderId,
      link: `/orders/${orderId}`,
    }).catch(() => {});

    createNotification({
      userId: order.sellerId,
      type: "SYSTEM",
      title: "Pickup rescheduled",
      body: `Pickup for "${order.listing.title}" confirmed: ${timeLabel}`,
      orderId,
      link: `/orders/${orderId}`,
    }).catch(() => {});

    orderEventService.recordEvent({
      orderId,
      type: ORDER_EVENT_TYPES.ORDER_CREATED,
      actorId: respondedById,
      actorRole:
        respondedByRole === "BUYER" ? ACTOR_ROLES.BUYER : ACTOR_ROLES.SELLER,
      summary: `Reschedule accepted — pickup confirmed for ${timeLabel}`,
      metadata: {
        action: "PICKUP_RESCHEDULE_ACCEPTED",
        confirmedTime: request.proposedTime.toISOString(),
      },
    });

    logger.info("pickup.reschedule.accepted", { orderId, respondedById });
    return { success: true };
  }

  if (response === "REJECT") {
    await db.$transaction(async (tx) => {
      await tx.pickupRescheduleRequest.update({
        where: { id: rescheduleRequestId },
        data: {
          status: "REJECTED",
          respondedAt: new Date(),
          responseNote: responseNote ?? null,
        },
      });

      // Revert to SCHEDULED — original pickupScheduledAt is unchanged
      await tx.order.update({
        where: { id: orderId },
        data: { pickupStatus: "SCHEDULED" },
      });

      const threadId = await findOrCreateThread(
        order.buyerId,
        order.sellerId,
        order.listingId,
        tx,
      );

      const card: PickupRescheduleResponseCard = {
        type: "PICKUP_RESCHEDULE_RESPONSE",
        response: "REJECTED",
        respondedBy: respondedByRole,
        originalTime: order.pickupScheduledAt?.toISOString() ?? "",
        newTime: null,
      };

      await createPickupMessage(threadId, respondedById, card, tx);
    });

    createNotification({
      userId: request.requestedById,
      type: "SYSTEM",
      title: "Reschedule request declined",
      body: `Your reschedule request for "${order.listing.title}" was declined. The original pickup time stands.`,
      orderId,
      link: `/orders/${orderId}`,
    }).catch(() => {});

    orderEventService.recordEvent({
      orderId,
      type: ORDER_EVENT_TYPES.ORDER_CREATED,
      actorId: respondedById,
      actorRole:
        respondedByRole === "BUYER" ? ACTOR_ROLES.BUYER : ACTOR_ROLES.SELLER,
      summary: `Reschedule request rejected${responseNote ? `: ${responseNote}` : ""}`,
      metadata: { action: "PICKUP_RESCHEDULE_REJECTED", responseNote },
    });

    logger.info("pickup.reschedule.rejected", { orderId, respondedById });
    return { success: true };
  }

  if (response === "PROPOSE_ALTERNATIVE") {
    if (!alternativeTime) {
      return { success: false, error: "Alternative time is required." };
    }

    // Validate alternative time
    const now = Date.now();
    if (alternativeTime.getTime() - now < pickupCfg.MIN_LEAD_TIME_MS) {
      return {
        success: false,
        error: "Alternative time must be at least 2 hours in the future.",
      };
    }
    if (alternativeTime.getTime() - now > pickupCfg.MAX_FUTURE_MS) {
      return {
        success: false,
        error: "Alternative time cannot be more than 30 days in the future.",
      };
    }

    // Reject the original request
    await db.pickupRescheduleRequest.update({
      where: { id: rescheduleRequestId },
      data: {
        status: "REJECTED",
        respondedAt: new Date(),
        responseNote: responseNote ?? null,
      },
    });

    // Counter-proposals do NOT increment rescheduleCount — call proposePickupTime
    const proposeResult = await proposePickupTime({
      orderId,
      proposedById: respondedById,
      proposedByRole: respondedByRole,
      proposedTime: alternativeTime,
    });

    return proposeResult;
  }

  return { success: false, error: "Invalid response." };
}

// ── cancelPickupOrder ────────────────────────────────────────────────────────

export async function cancelPickupOrder(params: {
  orderId: string;
  cancelledById: string;
  reason: string;
}): Promise<PickupResult> {
  const { orderId, cancelledById, reason } = params;
  const pickupCfg = await getPickupConfig();

  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      buyerId: true,
      sellerId: true,
      status: true,
      fulfillmentType: true,
      pickupStatus: true,
      pickupScheduledAt: true,
      rescheduleCount: true,
      stripePaymentIntentId: true,
      totalNzd: true,
      listingId: true,
      listing: { select: { title: true } },
    },
  });

  if (!order) return { success: false, error: "Order not found." };

  if (order.status !== "AWAITING_PICKUP") {
    return {
      success: false,
      error: "This order cannot be cancelled at this stage.",
    };
  }

  // Cannot cancel once OTP initiated or completed
  if (
    order.pickupStatus === "OTP_INITIATED" ||
    order.pickupStatus === "COMPLETED"
  ) {
    return {
      success: false,
      error: "Pickup is already in progress or completed.",
    };
  }

  // Validate canceller is a party
  if (cancelledById !== order.buyerId && cancelledById !== order.sellerId) {
    return { success: false, error: "You are not a party to this order." };
  }

  // If pickup is SCHEDULED and within 2 hours of pickupScheduledAt,
  // only allow if force-cancel eligible (rescheduleCount >= threshold)
  if (order.pickupStatus === "SCHEDULED" && order.pickupScheduledAt) {
    const hoursUntilPickup =
      (order.pickupScheduledAt.getTime() - Date.now()) / (1000 * 60 * 60);
    if (
      hoursUntilPickup <= 2 &&
      order.rescheduleCount < pickupCfg.FORCE_CANCEL_THRESHOLD
    ) {
      return {
        success: false,
        error:
          "Cannot cancel within 2 hours of scheduled pickup. Please reschedule instead.",
      };
    }
  }

  await db.$transaction(async (tx) => {
    await transitionOrder(
      orderId,
      "CANCELLED",
      {
        cancelledBy: cancelledById === order.buyerId ? "BUYER" : "SELLER",
        cancelReason: reason,
        cancelledAt: new Date(),
        pickupStatus: "CANCELLED",
        pickupCancelledAt: new Date(),
        pickupWindowJobId: null,
        scheduleDeadlineJobId: null,
      },
      { tx, fromStatus: order.status },
    );

    // Reactivate listing
    if (order.listingId) {
      await tx.listing.updateMany({
        where: { id: order.listingId, status: "RESERVED" },
        data: { status: "ACTIVE" },
      });
    }

    // Cancel any pending reschedule requests
    await tx.pickupRescheduleRequest.updateMany({
      where: { orderId, status: "PENDING" },
      data: { status: "CANCELLED" },
    });
  });

  // Refund buyer if online payment pickup
  if (
    order.fulfillmentType === "ONLINE_PAYMENT_PICKUP" &&
    order.stripePaymentIntentId
  ) {
    try {
      await paymentService.refundPayment({
        paymentIntentId: order.stripePaymentIntentId,
        orderId,
      });
    } catch (err) {
      logger.error("pickup.cancel.refund_failed", {
        orderId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const cancelledByRole = cancelledById === order.buyerId ? "BUYER" : "SELLER";
  const otherPartyId =
    cancelledById === order.buyerId ? order.sellerId : order.buyerId;

  // Audit
  audit({
    userId: cancelledById,
    action: "ORDER_STATUS_CHANGED",
    entityType: "Order",
    entityId: orderId,
    metadata: {
      newStatus: "CANCELLED",
      cancelledBy: cancelledByRole,
      reason,
      fulfillmentType: order.fulfillmentType,
    },
  });

  orderEventService.recordEvent({
    orderId,
    type: ORDER_EVENT_TYPES.CANCELLED,
    actorId: cancelledById,
    actorRole:
      cancelledByRole === "BUYER" ? ACTOR_ROLES.BUYER : ACTOR_ROLES.SELLER,
    summary: `${cancelledByRole === "BUYER" ? "Buyer" : "Seller"} cancelled pickup order: ${reason}`,
    metadata: { cancelledBy: cancelledByRole, reason },
  });

  // Notify both parties
  createNotification({
    userId: cancelledById,
    type: "SYSTEM",
    title: "Pickup order cancelled",
    body: `You cancelled the pickup order for "${order.listing.title}".`,
    orderId,
    link: `/orders/${orderId}`,
  }).catch(() => {});

  createNotification({
    userId: otherPartyId,
    type: "SYSTEM",
    title: "Pickup order cancelled",
    body: `The ${cancelledByRole.toLowerCase()} cancelled the pickup for "${order.listing.title}".${order.fulfillmentType === "ONLINE_PAYMENT_PICKUP" ? " A refund has been initiated." : ""}`,
    orderId,
    link: `/orders/${orderId}`,
  }).catch(() => {});

  logger.info("pickup.cancelled", { orderId, cancelledById, reason });

  return { success: true };
}
