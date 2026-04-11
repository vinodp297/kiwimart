// src/app/api/v1/metrics/route.ts
// ─── Operational Metrics — Admin Only ────────────────────────────────────────
// Returns a snapshot of queue depths and order health indicators.
// Requires the caller to be an admin user.
//
// Response shape:
//   {
//     queues: { [name]: { waiting: number, failed: number } },
//     orders: {
//       awaitingPaymentStale: number,   // AWAITING_PAYMENT > 1 hour
//       paymentHeldStale: number,        // PAYMENT_HELD > 7 days
//       disputedOpen: number,
//     }
//   }

import { requireApiUser, apiOk, apiError } from "../_helpers/response";
import { withCors } from "../_helpers/cors";
import { QUEUE_MAP } from "@/lib/queue";
import { orderRepository } from "@/modules/orders/order.repository";
import { logger } from "@/shared/logger";

export const dynamic = "force-dynamic";

const AWAITING_PAYMENT_STALE_MS = 60 * 60 * 1000; // 1 hour
const PAYMENT_HELD_STALE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function GET(request: Request) {
  const origin = request.headers.get("origin");
  try {
    const user = await requireApiUser(request);

    if (!user.isAdmin) {
      return withCors(
        apiError("Admin access required.", 403, "FORBIDDEN"),
        origin,
      );
    }

    const now = Date.now();
    const oneHourAgo = new Date(now - AWAITING_PAYMENT_STALE_MS);
    const sevenDaysAgo = new Date(now - PAYMENT_HELD_STALE_MS);

    // ── Queue metrics ─────────────────────────────────────────────────────────
    const queueEntries = await Promise.all(
      Object.entries(QUEUE_MAP).map(async ([name, queue]) => {
        const [waiting, failed] = await Promise.all([
          queue.getWaitingCount(),
          queue.getFailedCount(),
        ]);
        return [name, { waiting, failed }] as const;
      }),
    );
    const queues = Object.fromEntries(queueEntries);

    // ── Order health metrics ──────────────────────────────────────────────────
    const orders = await orderRepository.countMetrics(oneHourAgo, sevenDaysAgo);

    return withCors(apiOk({ queues, orders }), origin);
  } catch (e) {
    const err = e as { statusCode?: number; message?: string; code?: string };
    if (err.statusCode) {
      return withCors(
        apiError(err.message ?? "Unauthorised.", err.statusCode, err.code),
        origin,
      );
    }
    logger.error("metrics.error", {
      error: e instanceof Error ? e.message : String(e),
    });
    return withCors(apiError("Failed to fetch metrics.", 500), origin);
  }
}
