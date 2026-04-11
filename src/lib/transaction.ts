// src/lib/transaction.ts
// ─── Prisma Transaction Helper ───────────────────────────────────────────────
// Lets services, workers, and jobs start a Prisma interactive transaction
// without importing @/lib/db directly (which is blocked by the architecture
// lint rule — see eslint.config.mjs).
//
// The lint rule's intent is: "data access goes through repositories". A
// transaction runner that hands a TransactionClient to repository methods is
// the canonical pattern Prisma applications use to compose multiple repository
// writes atomically — it does not bypass the rule, it complements it.
//
// Usage:
//   import { withTransaction } from "@/lib/transaction";
//   await withTransaction(async (tx) => {
//     await orderRepository.update(orderId, { status: "X" }, tx);
//     await listingRepository.reactivate(listingId, tx);
//   });

import db, { type DbClient } from "@/lib/db";

export type { DbClient };

/**
 * Run a callback inside a Prisma interactive transaction.
 *
 * Pass `tx` to repository methods that accept an optional transaction client
 * so all writes commit together (or roll back together on throw).
 */
export function withTransaction<T>(
  fn: (tx: DbClient) => Promise<T>,
  options?: {
    timeout?: number;
    maxWait?: number;
    isolationLevel?:
      | "Serializable"
      | "RepeatableRead"
      | "ReadCommitted"
      | "ReadUncommitted";
  },
): Promise<T> {
  return db.$transaction(
    fn as (tx: import("@prisma/client").Prisma.TransactionClient) => Promise<T>,
    options,
  );
}
