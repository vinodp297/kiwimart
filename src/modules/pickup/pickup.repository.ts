// src/modules/pickup/pickup.repository.ts
// ─── Pickup repository — data access only, no business logic ────────────────
// All PickupRescheduleRequest reads/writes are routed through this module.

import db from "@/lib/db";
import { Prisma } from "@prisma/client";

type DbClient = Prisma.TransactionClient | typeof db;

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
   * @source src/server/services/pickup/pickup-proposal.service.ts,
   *         pickup-reschedule-respond.service.ts */
  async findRescheduleRequest(
    id: string,
    tx?: DbClient,
  ): Promise<RescheduleRequest | null> {
    const client = tx ?? db;
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
   * @source src/server/services/pickup/pickup-proposal.service.ts,
   *         pickup-reschedule-respond.service.ts */
  async updateRescheduleRequest(
    id: string,
    data: Prisma.PickupRescheduleRequestUncheckedUpdateInput,
    tx?: DbClient,
  ): Promise<void> {
    const client = tx ?? db;
    await client.pickupRescheduleRequest.update({ where: { id }, data });
  },

  /** Create a new reschedule request. Returns only the id.
   * @source src/server/services/pickup/pickup-reschedule.service.ts */
  async createRescheduleRequest(
    data: Prisma.PickupRescheduleRequestUncheckedCreateInput,
    tx?: DbClient,
  ): Promise<{ id: string }> {
    const client = tx ?? db;
    return client.pickupRescheduleRequest.create({
      data,
      select: { id: true },
    });
  },

  /** Cancel all pending reschedule requests on an order (order cancellation).
   * @source src/server/services/pickup/pickup-cancel.service.ts */
  async cancelPendingRescheduleRequests(
    orderId: string,
    tx?: DbClient,
  ): Promise<void> {
    const client = tx ?? db;
    await client.pickupRescheduleRequest.updateMany({
      where: { orderId, status: "PENDING" },
      data: { status: "CANCELLED" },
    });
  },

  /** Fire-and-forget setter for the BullMQ rescheduleJobId after enqueue.
   * @source src/server/services/pickup/pickup-reschedule.service.ts */
  setRescheduleJobId(id: string, jobId: string): void {
    db.pickupRescheduleRequest
      .update({ where: { id }, data: { rescheduleJobId: jobId } })
      .catch(() => {});
  },
};
