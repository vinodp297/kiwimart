import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

// ---------------------------------------------------------------------------
// Cart repository — data access only, no business logic.
// All stubs will be filled in Phase 2 by migrating calls from:
//   - src/server/actions/cart.ts
// ---------------------------------------------------------------------------

export type CartWithItems = Prisma.CartGetPayload<{
  include: {
    items: {
      include: {
        listing: {
          include: {
            images: { take: 1; orderBy: { order: "asc" } };
            seller: true;
          };
        };
      };
    };
  };
}>;

export const cartRepository = {
  /** Find a user's active cart with items and listings.
   * @source src/server/actions/cart.ts */
  async findByUser(userId: string): Promise<CartWithItems | null> {
    // TODO: move from src/server/actions/cart.ts
    throw new Error("Not implemented");
  },

  /** Create a new cart with the first item.
   * @source src/server/actions/cart.ts */
  async create(data: Prisma.CartCreateInput): Promise<CartWithItems> {
    // TODO: move from src/server/actions/cart.ts
    throw new Error("Not implemented");
  },

  /** Add an item to an existing cart and refresh expiry.
   * @source src/server/actions/cart.ts */
  async addItem(
    cartId: string,
    itemData: Prisma.CartItemCreateWithoutCartInput,
    expiresAt: Date,
  ): Promise<void> {
    // TODO: move from src/server/actions/cart.ts
    throw new Error("Not implemented");
  },

  /** Remove an item from a cart.
   * @source src/server/actions/cart.ts */
  async removeItem(itemId: string): Promise<void> {
    // TODO: move from src/server/actions/cart.ts
    throw new Error("Not implemented");
  },

  /** Delete a cart entirely (after checkout or when empty).
   * @source src/server/actions/cart.ts */
  async delete(cartId: string): Promise<void> {
    // TODO: move from src/server/actions/cart.ts
    throw new Error("Not implemented");
  },

  /** Delete all carts for a user (post-checkout cleanup).
   * @source src/server/actions/cart.ts */
  async deleteByUser(userId: string): Promise<void> {
    // TODO: move from src/server/actions/cart.ts
    throw new Error("Not implemented");
  },

  /** Find a cart item by ID.
   * @source src/server/actions/cart.ts */
  async findItemById(itemId: string): Promise<Prisma.CartItemGetPayload<{
    select: { id: true; cartId: true; listingId: true; priceNzd: true };
  }> | null> {
    // TODO: move from src/server/actions/cart.ts
    throw new Error("Not implemented");
  },
};
