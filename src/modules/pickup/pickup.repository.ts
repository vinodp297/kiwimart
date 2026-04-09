// src/modules/pickup/pickup.repository.ts
// ─── Pickup repository — data access only, no business logic ────────────────
// All PickupRescheduleRequest reads/writes are routed through this module.

import db, { getClient, type DbClient } from "@/lib/db";
import { fireAndForget } from "@/lib/fire-and-forget";
import { Prisma } from "@prisma/client";

export type RescheduleRequest = Prisma.PickupRescheduleRequestGetPayload<{
  select: {
    id: true;
    orderId: true;
    requestedById: true;
    requestedByRole: true;
    proposedTime: true;
    status: true;
    expiresAt: true;
  };
}>;

export const pickupRepository = {
  /** Fetch a reschedule request with the fields needed by the pickup flows.
   *         pickup-reschedule-respond.service.ts */
  async findRescheduleRequest(
    id: string,
    tx?: DbClient,
  ): Promise<RescheduleRequest | null> {
    const client = getClient(tx);
    return client.pickupRescheduleRequest.findUnique({
      where: { id },
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
  },

  /** Update a reschedule request (status / responseNote / respondedAt).
   *         pickup-reschedule-respond.service.ts */
  async updateRescheduleRequest(
    id: string,
    data: Prisma.PickupRescheduleRequestUncheckedUpdateInput,
    tx?: DbClient,
  ): Promise<void> {
    const client = getClient(tx);
    await client.pickupRescheduleRequest.update({ where: { id }, data });
  },

  /** Create a new reschedule request. Returns only the id. */
  async createRescheduleRequest(
    data: Prisma.PickupRescheduleRequestUncheckedCreateInput,
    tx?: DbClient,
  ): Promise<{ id: string }> {
    const client = getClient(tx);
    return client.pickupRescheduleRequest.create({
      data,
      select: { id: true },
    });
  },

  /** Cancel all pending reschedule requests on an order (order cancellation). */
  async cancelPendingRescheduleRequests(
    orderId: string,
    tx?: DbClient,
  ): Promise<void> {
    const client = getClient(tx);
    await client.pickupRescheduleRequest.updateMany({
      where: { orderId, status: "PENDING" },
      data: { status: "CANCELLED" },
    });
  },

  /** Fire-and-forget setter for the BullMQ rescheduleJobId after enqueue. */
  setRescheduleJobId(id: string, jobId: string): void {
    fireAndForget(
      db.pickupRescheduleRequest.update({
        where: { id },
        data: { rescheduleJobId: jobId },
      }),
      "pickup.setRescheduleJobId",
      { requestId: id, jobId },
    );
  },
};
