// src/modules/orders/order-interaction.service.ts
// ─── Order Interaction Service ──────────────────────────────────────────────
// Manages buyer-seller negotiations (cancellation requests, returns, etc.)
// Each interaction follows: request → response (accept/reject) → resolution.

import { interactionRepository } from "./interaction.repository";
import { logger } from "@/shared/logger";
import { AppError } from "@/shared/errors";
import type { Prisma } from "@prisma/client";
import type { DbClient } from "./order.repository";

// ── Constants ───────────────────────────────────────────────────────────────

export const INTERACTION_TYPES = {
  CANCEL_REQUEST: "CANCEL_REQUEST",
  RETURN_REQUEST: "RETURN_REQUEST",
  PARTIAL_REFUND_REQUEST: "PARTIAL_REFUND_REQUEST",
  DELIVERY_ISSUE: "DELIVERY_ISSUE",
  SHIPPING_DELAY: "SHIPPING_DELAY",
  OUT_OF_STOCK: "OUT_OF_STOCK",
  COUNTER_OFFER: "COUNTER_OFFER",
} as const;

export const INTERACTION_STATUSES = {
  PENDING: "PENDING",
  ACCEPTED: "ACCEPTED",
  REJECTED: "REJECTED",
  COUNTERED: "COUNTERED",
  EXPIRED: "EXPIRED",
  ESCALATED: "ESCALATED",
  RESOLVED: "RESOLVED",
} as const;

export const AUTO_ACTIONS = {
  AUTO_APPROVE: "AUTO_APPROVE",
  AUTO_REJECT: "AUTO_REJECT",
  AUTO_ESCALATE: "AUTO_ESCALATE",
} as const;

// ── Input types ─────────────────────────────────────────────────────────────

export interface CreateInteractionInput {
  orderId: string;
  type: string;
  initiatedById: string;
  initiatorRole: "BUYER" | "SELLER";
  reason: string;
  details?: Record<string, unknown>;
  expiresAt: Date;
  autoAction: string;
  /** Optional transaction client. When provided, all writes participate in the
   *  caller's transaction so the interaction row and event record are atomic. */
  tx?: DbClient;
}

// ── Service ─────────────────────────────────────────────────────────────────

export class OrderInteractionService {
  async createInteraction(input: CreateInteractionInput) {
    const { tx } = input;

    // Validate order exists and user is a party
    const order = await interactionRepository.findOrderForInteraction(
      input.orderId,
      tx,
    );

    if (!order) throw AppError.notFound("Order");

    const isParty =
      order.buyerId === input.initiatedById ||
      order.sellerId === input.initiatedById;
    if (!isParty) {
      throw AppError.unauthorised(
        "Only the buyer or seller can create an interaction.",
      );
    }

    // Check for duplicate active interaction of same type
    const existing = await interactionRepository.findPendingByTypeAndOrder(
      input.orderId,
      input.type,
      tx,
    );

    if (existing) {
      throw new AppError(
        "ORDER_WRONG_STATE",
        "There is already a pending request of this type on this order.",
        400,
      );
    }

    const interaction = await interactionRepository.createInteraction(
      {
        orderId: input.orderId,
        type: input.type,
        initiatedById: input.initiatedById,
        initiatorRole: input.initiatorRole,
        reason: input.reason,
        details: (input.details ?? undefined) as
          | Prisma.InputJsonValue
          | undefined,
        expiresAt: input.expiresAt,
        autoAction: input.autoAction,
      },
      tx,
    );

    logger.info("interaction.created", {
      interactionId: interaction.id,
      orderId: input.orderId,
      type: input.type,
      initiatorRole: input.initiatorRole,
    });

    return interaction;
  }

  async respondToInteraction(
    interactionId: string,
    responderId: string,
    action: "ACCEPT" | "REJECT",
    responseNote?: string,
  ) {
    const interaction =
      await interactionRepository.findByIdWithOrder(interactionId);

    if (!interaction) throw AppError.notFound("Interaction");

    if (interaction.status !== INTERACTION_STATUSES.PENDING) {
      throw new AppError(
        "ORDER_WRONG_STATE",
        "This request has already been responded to.",
        400,
      );
    }

    // Responder must be the OTHER party
    const isInitiator = interaction.initiatedById === responderId;
    const isParty =
      interaction.order.buyerId === responderId ||
      interaction.order.sellerId === responderId;

    if (isInitiator || !isParty) {
      throw AppError.unauthorised(
        "Only the other party can respond to this request.",
      );
    }

    const newStatus =
      action === "ACCEPT"
        ? INTERACTION_STATUSES.ACCEPTED
        : INTERACTION_STATUSES.REJECTED;

    await interactionRepository.updateInteraction(interactionId, {
      status: newStatus,
      responseById: responderId,
      responseNote: responseNote ?? null,
      respondedAt: new Date(),
      ...(action === "ACCEPT"
        ? { resolvedAt: new Date(), resolution: "CANCELLED" }
        : {}),
    });

    logger.info("interaction.responded", {
      interactionId,
      orderId: interaction.orderId,
      action,
      responderId,
    });

    return { interaction, action };
  }

  async getActiveInteractions(orderId: string) {
    return interactionRepository.findActiveByOrder(orderId);
  }

  async getInteractionsByOrder(orderId: string) {
    return interactionRepository.findAllByOrder(orderId);
  }
}

export const orderInteractionService = new OrderInteractionService();
