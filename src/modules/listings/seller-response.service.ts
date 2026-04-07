// src/modules/listings/seller-response.service.ts
// ─── Seller Response Time ─────────────────────────────────────────────────────
// Computes the median time a seller takes to reply to a message thread.
// Cached with a 1-hour TTL per seller to avoid expensive repeated DB queries.

import { unstable_cache } from "next/cache";
import { sellerRepository } from "@/modules/sellers/seller.repository";

const LABELS: [number, string][] = [
  [1, "Usually replies within 1 hour"],
  [4, "Usually replies within a few hours"],
  [24, "Usually replies within a day"],
  [72, "Usually replies within a few days"],
];

/**
 * Returns a human-readable label for a seller's median response time,
 * or null if there is not enough message data (< 3 threads) to compute it.
 */
export const getSellerResponseTime = unstable_cache(
  async (sellerId: string): Promise<string | null> => {
    // Find all threads where this user is a participant
    const threads =
      await sellerRepository.findMessageThreadsForMetrics(sellerId);

    // For each thread, find the first reply FROM the seller after a buyer message
    const replyMs: number[] = [];

    for (const thread of threads) {
      const msgs = thread.messages;
      if (msgs.length < 2) continue;

      // Find the first message NOT from seller (buyer opens the thread)
      const buyerFirstIdx = msgs.findIndex((m) => m.senderId !== sellerId);
      if (buyerFirstIdx < 0) continue;

      // Find the first seller reply after the buyer's first message
      const sellerReply = msgs
        .slice(buyerFirstIdx + 1)
        .find((m) => m.senderId === sellerId);
      if (!sellerReply) continue;

      const delta =
        sellerReply.createdAt.getTime() -
        (msgs[buyerFirstIdx]?.createdAt.getTime() ?? 0);
      if (delta > 0) replyMs.push(delta);
    }

    if (replyMs.length < 3) return null;

    // Compute median
    replyMs.sort((a, b) => a - b);
    const medianMs = replyMs[Math.floor(replyMs.length / 2)] ?? 0;
    const medianHours = medianMs / (1000 * 60 * 60);

    for (const [hours, label] of LABELS) {
      if (medianHours <= hours) return label;
    }
    return "Response time varies";
  },
  ["seller-response-time"],
  { revalidate: 3600 }, // 1-hour TTL
);
