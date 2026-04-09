// src/modules/sellers/response-metrics.service.ts
// ─── Seller Response Metrics — fire-and-forget background calculation ────────

import { sellerRepository } from "./seller.repository";
import { logger } from "@/shared/logger";
import { MS_PER_DAY } from "@/lib/time";

/**
 * Recalculate a seller's response metrics from their message threads.
 * Call fire-and-forget after a seller sends a message.
 */
export async function updateSellerResponseMetrics(
  sellerId: string,
): Promise<void> {
  try {
    const threads =
      await sellerRepository.findMessageThreadsForMetrics(sellerId);

    const replyMs: number[] = [];
    let repliedWithin24h = 0;
    let totalBuyerThreads = 0;

    for (const thread of threads) {
      const msgs = thread.messages;
      if (msgs.length < 2) continue;

      // Find the first message NOT from seller
      const buyerFirstIdx = msgs.findIndex((m) => m.senderId !== sellerId);
      if (buyerFirstIdx < 0) continue;

      totalBuyerThreads++;

      // Find the first seller reply after buyer's first message
      const sellerReply = msgs
        .slice(buyerFirstIdx + 1)
        .find((m) => m.senderId === sellerId);
      if (!sellerReply) continue;

      const delta =
        sellerReply.createdAt.getTime() -
        (msgs[buyerFirstIdx]?.createdAt.getTime() ?? 0);
      if (delta > 0) {
        replyMs.push(delta);
        if (delta <= MS_PER_DAY) {
          repliedWithin24h++;
        }
      }
    }

    if (replyMs.length < 3) return;

    // Compute average response time in minutes
    const avgMs = replyMs.reduce((a, b) => a + b, 0) / replyMs.length;
    const avgMinutes = Math.round(avgMs / (1000 * 60));

    // Response rate: threads with seller reply within 24hrs / total threads
    const responseRate =
      totalBuyerThreads > 0 ? (repliedWithin24h / totalBuyerThreads) * 100 : 0;

    await sellerRepository.updateResponseMetrics(
      sellerId,
      avgMinutes,
      responseRate,
    );
  } catch (err) {
    logger.warn("seller.response_metrics.update_failed", {
      sellerId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Get human-readable response label from average minutes.
 */
export function getResponseLabel(minutes: number | null): string {
  if (minutes === null || minutes === undefined) return "New seller";
  if (minutes <= 60) return "Replies within 1 hour";
  if (minutes <= 240) return "Replies within a few hours";
  if (minutes <= 1440) return "Replies within a day";
  return "Slow to respond";
}

/**
 * Get CSS colour class for response label.
 */
export function getResponseColour(minutes: number | null): string {
  if (minutes === null || minutes === undefined) return "text-[#9E9A91]";
  if (minutes <= 60) return "text-emerald-600";
  if (minutes <= 240) return "text-amber-600";
  if (minutes <= 1440) return "text-[#73706A]";
  return "text-red-500";
}
