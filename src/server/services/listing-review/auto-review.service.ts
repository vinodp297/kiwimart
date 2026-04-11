// src/server/services/listing-review/auto-review.service.ts
// ─── Listing Auto-Review Service ───────────────────────────────────────────
// Runs synchronously on every listing submission.
// Returns a verdict: 'publish' | 'queue' | 'reject'
//
// Hard reject rules return immediately.
// Risk flags accumulate a score — score alone never auto-rejects, only queues.

import { CONFIG_KEYS, getConfigMany } from "@/lib/platform-config";
import type { ConfigKey } from "@/lib/platform-config";
import { logger } from "@/shared/logger";
import { getKeywordLists } from "@/lib/dynamic-lists";
import { listingRepository } from "@/modules/listings/listing.repository";

// ── Types ────────────────────────────────────────────────────────────────────

export interface AutoReviewInput {
  listingId: string; // used to exclude self from duplicate detection
  title: string;
  description: string;
  priceNzd: number; // in cents
  categoryId: string;
  images: { isSafe: boolean | null }[];
}

export interface SellerProfile {
  id: string;
  sellerLevel: string; // 'LEVEL_1' | 'LEVEL_2' | 'LEVEL_3'
  isBanned: boolean;
  isFlaggedForFraud: boolean;
  disputeRate: number; // 0-1 scale (0.1 = 10%)
  totalApprovedListings: number;
}

export interface AutoReviewResult {
  verdict: "publish" | "queue" | "reject";
  score: number;
  flags: string[];
  rejectReason?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Check if any keyword from the list appears in text (case-insensitive, word boundary). */
function containsKeyword(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((kw) => {
    // For multi-word keywords, use simple includes
    if (kw.includes(" ")) {
      return lower.includes(kw.toLowerCase());
    }
    // For single words, use word boundary regex
    const regex = new RegExp(`\\b${escapeRegex(kw)}\\b`, "i");
    return regex.test(text);
  });
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** NZ phone number patterns: 02x, +64, 0800, 0508 */
const PHONE_REGEX =
  /(?:\+64|0)\s*(?:2[0-9]|3|4|6|7|9|21|22|27|28|29)\s*[\d\s-]{6,10}|0800\s*[\d\s-]{5,8}|0508\s*[\d\s-]{5,8}/i;

/** Email pattern */
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

/** URL pattern */
const URL_REGEX =
  /(?:https?:\/\/|www\.)[^\s]+|[a-zA-Z0-9-]+\.(?:com|co\.nz|nz|org|net)\b/i;

// ── Main Service ─────────────────────────────────────────────────────────────

export async function runAutoReview(
  listing: AutoReviewInput,
  seller: SellerProfile,
): Promise<AutoReviewResult> {
  const combinedText = `${listing.title} ${listing.description}`;

  // ── Load keyword lists from DB ─────────────────────────────────────────
  const { banned: bannedKeywords, risk: riskKeywords } =
    await getKeywordLists();

  // ── Load platform config ────────────────────────────────────────────────
  const config = await getConfigMany([
    CONFIG_KEYS.LISTING_MIN_TITLE_LENGTH,
    CONFIG_KEYS.LISTING_MAX_TITLE_LENGTH,
    CONFIG_KEYS.LISTING_MIN_DESCRIPTION_LENGTH,
    CONFIG_KEYS.LISTING_SHORT_DESC_THRESHOLD,
    CONFIG_KEYS.LISTING_HIGH_VALUE_THRESHOLD_CENTS,
    CONFIG_KEYS.LISTING_L1_MAX_ACTIVE,
    CONFIG_KEYS.LISTING_AUTO_PUBLISH_MAX_SCORE,
    CONFIG_KEYS.LISTING_DUPLICATE_WINDOW_DAYS,
    CONFIG_KEYS.LISTING_FIRST_LISTINGS_THRESHOLD,
    CONFIG_KEYS.RISK_SCORE_SINGLE_IMAGE,
    CONFIG_KEYS.RISK_SCORE_SHORT_DESC,
    CONFIG_KEYS.RISK_SCORE_PHONE_IN_LISTING,
    CONFIG_KEYS.RISK_SCORE_EMAIL_IN_LISTING,
    CONFIG_KEYS.RISK_SCORE_EXTERNAL_URL,
    CONFIG_KEYS.RISK_SCORE_RISK_KEYWORD,
    CONFIG_KEYS.RISK_SCORE_HIGH_DISPUTE_RATE,
    CONFIG_KEYS.RISK_SCORE_NEW_SELLER,
    CONFIG_KEYS.RISK_SCORE_HIGH_VALUE,
    CONFIG_KEYS.RISK_SCORE_DUPLICATE,
    CONFIG_KEYS.RISK_SCORE_FIRST_LISTINGS,
    CONFIG_KEYS.SELLER_HIGH_DISPUTE_RATE_PCT,
    CONFIG_KEYS.L1_MAX_PRICE_CENTS,
    CONFIG_KEYS.PLATFORM_MAX_PRICE_CENTS,
  ]);

  const cfgInt = (k: ConfigKey, fallback: number) =>
    parseInt(config.get(k) ?? String(fallback), 10);

  const minTitleLen = cfgInt(CONFIG_KEYS.LISTING_MIN_TITLE_LENGTH, 5);
  const maxTitleLen = cfgInt(CONFIG_KEYS.LISTING_MAX_TITLE_LENGTH, 80);
  const minDescLen = cfgInt(CONFIG_KEYS.LISTING_MIN_DESCRIPTION_LENGTH, 50);
  const shortDescThreshold = cfgInt(
    CONFIG_KEYS.LISTING_SHORT_DESC_THRESHOLD,
    100,
  );
  const highValueThreshold = cfgInt(
    CONFIG_KEYS.LISTING_HIGH_VALUE_THRESHOLD_CENTS,
    50_000,
  );
  const l1MaxActive = cfgInt(CONFIG_KEYS.LISTING_L1_MAX_ACTIVE, 3);
  const autoPublishMaxScore = cfgInt(
    CONFIG_KEYS.LISTING_AUTO_PUBLISH_MAX_SCORE,
    30,
  );
  const duplicateWindowDays = cfgInt(
    CONFIG_KEYS.LISTING_DUPLICATE_WINDOW_DAYS,
    7,
  );
  const firstListingsThreshold = cfgInt(
    CONFIG_KEYS.LISTING_FIRST_LISTINGS_THRESHOLD,
    3,
  );
  const riskScoreSingleImage = cfgInt(CONFIG_KEYS.RISK_SCORE_SINGLE_IMAGE, 15);
  const riskScoreShortDesc = cfgInt(CONFIG_KEYS.RISK_SCORE_SHORT_DESC, 15);
  const riskScorePhone = cfgInt(CONFIG_KEYS.RISK_SCORE_PHONE_IN_LISTING, 45);
  const riskScoreEmail = cfgInt(CONFIG_KEYS.RISK_SCORE_EMAIL_IN_LISTING, 45);
  const riskScoreUrl = cfgInt(CONFIG_KEYS.RISK_SCORE_EXTERNAL_URL, 35);
  const riskScoreKeyword = cfgInt(CONFIG_KEYS.RISK_SCORE_RISK_KEYWORD, 30);
  const riskScoreHighDispute = cfgInt(
    CONFIG_KEYS.RISK_SCORE_HIGH_DISPUTE_RATE,
    40,
  );
  const riskScoreNewSeller = cfgInt(CONFIG_KEYS.RISK_SCORE_NEW_SELLER, 20);
  const riskScoreHighValue = cfgInt(CONFIG_KEYS.RISK_SCORE_HIGH_VALUE, 50);
  const riskScoreDuplicate = cfgInt(CONFIG_KEYS.RISK_SCORE_DUPLICATE, 50);
  const riskScoreFirstListings = cfgInt(
    CONFIG_KEYS.RISK_SCORE_FIRST_LISTINGS,
    30,
  );
  const sellerHighDisputeRatePct = cfgInt(
    CONFIG_KEYS.SELLER_HIGH_DISPUTE_RATE_PCT,
    10,
  );
  const l1MaxPrice = cfgInt(CONFIG_KEYS.L1_MAX_PRICE_CENTS, 10_000);
  const platformMaxPrice = cfgInt(
    CONFIG_KEYS.PLATFORM_MAX_PRICE_CENTS,
    5_000_000,
  );

  // ════════════════════════════════════════════════════════════════════════════
  // HARD REJECT RULES — return immediately
  // ════════════════════════════════════════════════════════════════════════════

  if (seller.isBanned) {
    return {
      verdict: "reject",
      score: 100,
      flags: ["SELLER_BANNED"],
      rejectReason: "Your account is not eligible to list items.",
    };
  }

  if (seller.isFlaggedForFraud) {
    return {
      verdict: "reject",
      score: 100,
      flags: ["SELLER_FRAUD_FLAG"],
      rejectReason: "Your account requires review before listing.",
    };
  }

  if (containsKeyword(combinedText, bannedKeywords)) {
    return {
      verdict: "reject",
      score: 100,
      flags: ["PROHIBITED_CONTENT"],
      rejectReason:
        "Your listing contains prohibited content. Review our listing policies.",
    };
  }

  if (listing.images.length === 0) {
    return {
      verdict: "reject",
      score: 100,
      flags: ["NO_IMAGES"],
      rejectReason: "At least one image is required.",
    };
  }

  if (listing.images.every((img) => img.isSafe === false)) {
    return {
      verdict: "reject",
      score: 100,
      flags: ["UNSAFE_IMAGES"],
      rejectReason:
        "Your images failed our safety check. Please upload clear photos of the actual item.",
    };
  }

  if (listing.title.trim().length < minTitleLen) {
    return {
      verdict: "reject",
      score: 100,
      flags: ["TITLE_TOO_SHORT"],
      rejectReason: `Title must be at least ${minTitleLen} characters.`,
    };
  }

  if (listing.title.trim().length > maxTitleLen) {
    return {
      verdict: "reject",
      score: 100,
      flags: ["TITLE_TOO_LONG"],
      rejectReason: `Title must be under ${maxTitleLen} characters.`,
    };
  }

  if (listing.description.trim().length < minDescLen) {
    return {
      verdict: "reject",
      score: 100,
      flags: ["DESCRIPTION_TOO_SHORT"],
      rejectReason: `Description must be at least ${minDescLen} characters. Describe the item honestly including any defects.`,
    };
  }

  if (listing.priceNzd <= 0) {
    return {
      verdict: "reject",
      score: 100,
      flags: ["INVALID_PRICE"],
      rejectReason: "Price must be greater than $0.",
    };
  }

  if (listing.priceNzd > platformMaxPrice) {
    return {
      verdict: "reject",
      score: 100,
      flags: ["PRICE_TOO_HIGH"],
      rejectReason: "Price exceeds the maximum allowed listing value.",
    };
  }

  if (seller.sellerLevel === "LEVEL_1" && listing.priceNzd > l1MaxPrice) {
    return {
      verdict: "reject",
      score: 100,
      flags: ["L1_PRICE_CAP"],
      rejectReason: `As a new seller, listings are limited to $${(l1MaxPrice / 100).toFixed(0)} NZD. Complete verification to list higher-value items.`,
    };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // L1 LISTING LIMIT CHECK — hard reject
  // ════════════════════════════════════════════════════════════════════════════

  if (seller.sellerLevel === "LEVEL_1") {
    const activeCount =
      await listingRepository.countActiveSlotsForSellerExcluding(
        seller.id,
        listing.listingId,
      );

    if (activeCount >= l1MaxActive) {
      return {
        verdict: "reject",
        score: 100,
        flags: ["L1_LISTING_LIMIT"],
        rejectReason: `New sellers are limited to ${l1MaxActive} active listings. Complete verification to list more items.`,
      };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // RISK FLAG CHECKS — accumulate score, never auto-reject
  // ════════════════════════════════════════════════════════════════════════════

  let score = 0;
  const flags: string[] = [];

  // Single image
  if (listing.images.length === 1) {
    flags.push("SINGLE_IMAGE");
    score += riskScoreSingleImage;
  }

  // Image safety is pre-checked in createListing before auto-review runs

  // Short description
  if (listing.description.trim().length < shortDescThreshold) {
    flags.push("SHORT_DESCRIPTION");
    score += riskScoreShortDesc;
  }

  // Phone number in text
  if (PHONE_REGEX.test(combinedText)) {
    flags.push("CONTACT_INFO_PHONE");
    score += riskScorePhone;
  }

  // Email in text
  if (EMAIL_REGEX.test(combinedText)) {
    flags.push("CONTACT_INFO_EMAIL");
    score += riskScoreEmail;
  }

  // External URL in description
  if (URL_REGEX.test(listing.description)) {
    flags.push("EXTERNAL_URL");
    score += riskScoreUrl;
  }

  // Risk keywords
  if (containsKeyword(combinedText, riskKeywords)) {
    flags.push("RISK_KEYWORD");
    score += riskScoreKeyword;
  }

  // High dispute rate
  if (seller.disputeRate > sellerHighDisputeRatePct / 100) {
    flags.push("HIGH_DISPUTE_RATE");
    score += riskScoreHighDispute;
  }

  // New seller
  if (seller.sellerLevel === "LEVEL_1") {
    flags.push("NEW_SELLER");
    score += riskScoreNewSeller;
  }

  // High value item
  if (listing.priceNzd > highValueThreshold) {
    flags.push("HIGH_VALUE_ITEM");
    score += riskScoreHighValue;
  }

  // ── Duplicate detection ──────────────────────────────────────────────────

  const titlePrefix = listing.title.trim().substring(0, 30).toLowerCase();
  if (titlePrefix.length > 5) {
    const windowAgo = new Date(
      Date.now() - duplicateWindowDays * 24 * 60 * 60 * 1000,
    );
    try {
      const duplicate = await listingRepository.findRecentDuplicateBySeller({
        sellerId: seller.id,
        excludeListingId: listing.listingId,
        titlePrefix,
        since: windowAgo,
      });

      if (duplicate) {
        flags.push("DUPLICATE_LISTING");
        score += riskScoreDuplicate;
      }
    } catch (err) {
      logger.warn("auto-review:duplicate-check-failed", {
        sellerId: seller.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── First listings rule ────────────────────────────────────────────────────

  if (seller.totalApprovedListings < firstListingsThreshold) {
    flags.push("FIRST_LISTINGS");
    score += riskScoreFirstListings;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // FINAL VERDICT
  // ════════════════════════════════════════════════════════════════════════════
  // Score alone NEVER auto-rejects. Only the hard rules above can reject.

  let verdict: "publish" | "queue";
  if (score <= autoPublishMaxScore) {
    verdict = "publish";
  } else {
    verdict = "queue";
  }

  logger.info("auto-review:completed", {
    sellerId: seller.id,
    verdict,
    score,
    flags,
    title: listing.title.substring(0, 50),
  });

  return { verdict, score, flags };
}
