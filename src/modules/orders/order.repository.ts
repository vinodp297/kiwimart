// src/modules/orders/order.repository.ts (barrel — under 50 lines)
// ─── Re-exports from focused sub-files ───────────────────────────────────────

export type {
  DbClient,
  OrderWithRelations,
  OrderForStatus,
} from "./order-query.repository";

import { orderQueryRepository } from "./order-query.repository";
import { orderMutationRepository } from "./order-mutation.repository";
import { orderCronRepository } from "./order-cron.repository";

export const orderRepository = {
  ...orderQueryRepository,
  ...orderMutationRepository,
  ...orderCronRepository,
};
