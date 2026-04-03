import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

// ---------------------------------------------------------------------------
// Order repository — data access only, no business logic.
// All stubs will be filled in Phase 2 by migrating calls from:
//   - src/modules/orders/order.service.ts
//   - src/server/actions/orders.ts
// ---------------------------------------------------------------------------

export type OrderWithRelations = Prisma.OrderGetPayload<{
  include: {
    listing: { include: { images: true; seller: true } };
    buyer: {
      select: { id: true; displayName: true; username: true; email: true };
    };
    seller: {
      select: {
        id: true;
        displayName: true;
        username: true;
        stripeAccountId: true;
      };
    };
    items: true;
  };
}>;

export type OrderForStatus = Prisma.OrderGetPayload<{
  select: {
    id: true;
    status: true;
    buyerId: true;
    sellerId: true;
    listingId: true;
    createdAt: true;
    priceNzd: true;
    platformFeeNzd: true;
    stripePaymentIntentId: true;
  };
}>;

export const orderRepository = {
  /** Find an order by ID with full relations.
   * @source src/modules/orders/order.service.ts */
  async findByIdWithRelations(id: string): Promise<OrderWithRelations | null> {
    // TODO: move from src/modules/orders/order.service.ts
    throw new Error("Not implemented");
  },

  /** Find an order by ID with a minimal status select.
   * @source src/modules/orders/order.service.ts */
  async findByIdForStatus(id: string): Promise<OrderForStatus | null> {
    // TODO: move from src/modules/orders/order.service.ts
    throw new Error("Not implemented");
  },

  /** Find an order visible to a specific user (buyer or seller).
   * @source src/modules/orders/order.service.ts */
  async findByIdForUser(
    id: string,
    userId: string,
  ): Promise<OrderForStatus | null> {
    // TODO: move from src/modules/orders/order.service.ts
    throw new Error("Not implemented");
  },

  /** Idempotency check — find an existing order by key.
   * @source src/server/actions/orders.ts */
  async findByIdempotencyKey(
    key: string,
    buyerId: string,
  ): Promise<Prisma.OrderGetPayload<{ select: { id: true } }> | null> {
    // TODO: move from src/server/actions/orders.ts
    throw new Error("Not implemented");
  },

  /** Create a new order (called inside a transaction).
   * @source src/server/actions/orders.ts, src/server/actions/cart.ts */
  async create(
    data: Prisma.OrderCreateInput,
    tx?: Prisma.TransactionClient,
  ): Promise<Prisma.OrderGetPayload<{ select: { id: true; status: true } }>> {
    // TODO: move from src/server/actions/orders.ts
    throw new Error("Not implemented");
  },

  /** Update an order's Stripe payment intent ID.
   * @source src/server/actions/orders.ts */
  async setStripePaymentIntentId(
    id: string,
    stripePaymentIntentId: string,
  ): Promise<void> {
    // TODO: move from src/server/actions/orders.ts
    throw new Error("Not implemented");
  },

  /** Find the Stripe PI ID for orphan cleanup.
   * @source src/server/actions/orders.ts */
  async findStripePaymentIntentId(
    id: string,
  ): Promise<Prisma.OrderGetPayload<{
    select: { stripePaymentIntentId: true };
  }> | null> {
    // TODO: move from src/server/actions/orders.ts
    throw new Error("Not implemented");
  },

  /** Fetch orders for a buyer (paginated).
   * @source src/app/api/v1/orders/route.ts */
  async findByBuyer(
    buyerId: string,
    take: number,
    cursor?: string,
  ): Promise<OrderForStatus[]> {
    // TODO: move from src/app/api/v1/orders/route.ts
    throw new Error("Not implemented");
  },

  /** Update order status.
   * @source src/modules/orders/order.service.ts */
  async updateStatus(
    id: string,
    status: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    // TODO: move from src/modules/orders/order.service.ts
    throw new Error("Not implemented");
  },

  /** Count recent disputes for a buyer (abuse detection).
   * @source src/modules/orders/order.service.ts, src/server/actions/disputes.ts */
  async countRecentBuyerDisputes(
    buyerId: string,
    since: Date,
  ): Promise<number> {
    // TODO: move from src/modules/orders/order.service.ts
    throw new Error("Not implemented");
  },
};
