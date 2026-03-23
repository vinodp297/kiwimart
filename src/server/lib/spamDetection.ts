// src/server/lib/spamDetection.ts
// ─── Spam Detection ──────────────────────────────────────────────────────────
// Heuristic-based spam detection for listings, messages, and reviews.
// Runs alongside content moderation as a second layer of protection.
//
// Signals:
//   • Listing velocity (too many listings in short time)
//   • Duplicate content detection (same title/description across listings)
//   • New account + high-value listing (common scam pattern)
//   • Message flooding (same message to many users)
//
// Returns a SpamScore — callers decide threshold for blocking vs flagging.

import db from '@/lib/db';

export interface SpamScore {
  /** 0–100 score, higher = more likely spam */
  score: number;
  /** Human-readable signals that contributed to the score */
  signals: string[];
  /** Whether to block (score >= 80) */
  block: boolean;
  /** Whether to flag for review (score >= 40) */
  flag: boolean;
}

/**
 * Check if a listing creation looks like spam.
 * Call before saving a new listing to the database.
 */
export async function checkListingSpam(params: {
  userId: string;
  title: string;
  description: string;
  priceNzd: number;
  accountCreatedAt: Date;
}): Promise<SpamScore> {
  const signals: string[] = [];
  let score = 0;

  // 1. Account age check — new accounts creating expensive listings
  const accountAgeDays = (Date.now() - params.accountCreatedAt.getTime()) / (1000 * 60 * 60 * 24);
  if (accountAgeDays < 1 && params.priceNzd > 50000) {
    score += 30;
    signals.push('new_account_high_value');
  } else if (accountAgeDays < 7 && params.priceNzd > 100000) {
    score += 20;
    signals.push('young_account_expensive_listing');
  }

  // 2. Listing velocity — check how many listings created in the last hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recentListingCount = await db.listing.count({
    where: {
      sellerId: params.userId,
      createdAt: { gte: oneHourAgo },
    },
  });

  if (recentListingCount >= 10) {
    score += 40;
    signals.push('high_listing_velocity');
  } else if (recentListingCount >= 5) {
    score += 20;
    signals.push('moderate_listing_velocity');
  }

  // 3. Duplicate title check
  const duplicateTitle = await db.listing.count({
    where: {
      sellerId: params.userId,
      title: params.title,
      deletedAt: null,
    },
  });

  if (duplicateTitle > 0) {
    score += 25;
    signals.push('duplicate_title');
  }

  // 4. Suspiciously short description for high-value items
  if (params.priceNzd > 10000 && params.description.length < 50) {
    score += 15;
    signals.push('short_description_high_value');
  }

  return {
    score,
    signals,
    block: score >= 80,
    flag: score >= 40,
  };
}

/**
 * Check if a message looks like spam (flooding, copy-paste).
 */
export async function checkMessageSpam(params: {
  userId: string;
  body: string;
}): Promise<SpamScore> {
  const signals: string[] = [];
  let score = 0;

  // 1. Message velocity — check how many messages sent in the last 5 minutes
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
  const recentMessageCount = await db.message.count({
    where: {
      senderId: params.userId,
      createdAt: { gte: fiveMinAgo },
    },
  });

  if (recentMessageCount >= 20) {
    score += 50;
    signals.push('message_flooding');
  } else if (recentMessageCount >= 10) {
    score += 25;
    signals.push('high_message_velocity');
  }

  // 2. Check for identical messages sent to different threads
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const identicalMessages = await db.message.count({
    where: {
      senderId: params.userId,
      body: params.body,
      createdAt: { gte: oneHourAgo },
    },
  });

  if (identicalMessages >= 3) {
    score += 35;
    signals.push('duplicate_messages');
  }

  return {
    score,
    signals,
    block: score >= 80,
    flag: score >= 40,
  };
}
