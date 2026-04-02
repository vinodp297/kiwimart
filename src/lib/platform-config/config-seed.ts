import defaultDb from "@/lib/db";
import { CONFIG_KEYS } from "./config-keys";

type DbClient = typeof defaultDb;

/**
 * Seed all PlatformConfig records.
 * Accepts an optional db client for use in prisma/seed.ts which
 * creates its own PrismaClient instance outside the Next.js runtime.
 */
export async function seedPlatformConfig(dbOverride?: DbClient) {
  const db = dbOverride ?? defaultDb;

  async function seed(params: {
    key: string;
    value: string;
    type: "INTEGER" | "DECIMAL" | "BOOLEAN" | "STRING" | "JSON";
    category:
      | "SELLER_TIERS"
      | "FINANCIAL"
      | "TIME_LIMITS"
      | "LISTING_RULES"
      | "FRAUD_RULES"
      | "PICKUP_RULES"
      | "PLATFORM_LIMITS";
    label: string;
    description: string;
    unit?: string;
    minValue?: string;
    maxValue?: string;
  }) {
    const { key, ...rest } = params;
    await db.platformConfig.upsert({
      where: { key },
      create: { key, ...rest },
      update: {},
    });
  }
  // ── SELLER_TIERS ────────────────────────────────────────────────────────────

  await seed({
    key: CONFIG_KEYS.GOLD_MIN_SALES,
    value: "50",
    type: "INTEGER",
    category: "SELLER_TIERS",
    label: "Gold tier — min sales",
    description: "Completed sales required to reach Gold seller status",
    unit: "sales",
    minValue: "1",
    maxValue: "1000",
  });

  await seed({
    key: CONFIG_KEYS.GOLD_MIN_RATING,
    value: "4.5",
    type: "DECIMAL",
    category: "SELLER_TIERS",
    label: "Gold tier — min rating",
    description: "Minimum average review rating for Gold status",
    unit: "stars",
    minValue: "1",
    maxValue: "5",
  });

  await seed({
    key: CONFIG_KEYS.GOLD_MIN_COMPLETION_RATE,
    value: "95",
    type: "DECIMAL",
    category: "SELLER_TIERS",
    label: "Gold tier — completion rate %",
    description: "Order completion rate % required for Gold status",
    unit: "%",
    minValue: "50",
    maxValue: "100",
  });

  await seed({
    key: CONFIG_KEYS.SILVER_MIN_SALES,
    value: "20",
    type: "INTEGER",
    category: "SELLER_TIERS",
    label: "Silver tier — min sales",
    description: "Completed sales required to reach Silver seller status",
    unit: "sales",
    minValue: "1",
    maxValue: "500",
  });

  await seed({
    key: CONFIG_KEYS.SILVER_MIN_RATING,
    value: "4.0",
    type: "DECIMAL",
    category: "SELLER_TIERS",
    label: "Silver tier — min rating",
    description: "Minimum average review rating for Silver status",
    unit: "stars",
    minValue: "1",
    maxValue: "5",
  });

  await seed({
    key: CONFIG_KEYS.SILVER_MIN_COMPLETION_RATE,
    value: "90",
    type: "DECIMAL",
    category: "SELLER_TIERS",
    label: "Silver tier — completion rate %",
    description: "Order completion rate % required for Silver status",
    unit: "%",
    minValue: "50",
    maxValue: "100",
  });

  await seed({
    key: CONFIG_KEYS.BRONZE_MIN_SALES,
    value: "5",
    type: "INTEGER",
    category: "SELLER_TIERS",
    label: "Bronze tier — min sales",
    description: "Completed sales required to reach Bronze seller status",
    unit: "sales",
    minValue: "1",
    maxValue: "100",
  });

  await seed({
    key: CONFIG_KEYS.BRONZE_MIN_RATING,
    value: "3.5",
    type: "DECIMAL",
    category: "SELLER_TIERS",
    label: "Bronze tier — min rating",
    description: "Minimum average review rating for Bronze status",
    unit: "stars",
    minValue: "1",
    maxValue: "5",
  });

  await seed({
    key: CONFIG_KEYS.BRONZE_MIN_COMPLETION_RATE,
    value: "80",
    type: "DECIMAL",
    category: "SELLER_TIERS",
    label: "Bronze tier — completion rate %",
    description: "Order completion rate % required for Bronze status",
    unit: "%",
    minValue: "50",
    maxValue: "100",
  });

  await seed({
    key: CONFIG_KEYS.BASIC_MAX_LISTINGS,
    value: "10",
    type: "INTEGER",
    category: "SELLER_TIERS",
    label: "Basic seller — listing cap",
    description: "Maximum active listings for unverified sellers",
    unit: "listings",
    minValue: "1",
    maxValue: "100",
  });

  await seed({
    key: CONFIG_KEYS.PHONE_MAX_LISTINGS,
    value: "50",
    type: "INTEGER",
    category: "SELLER_TIERS",
    label: "Phone-verified — listing cap",
    description: "Maximum active listings for phone-verified sellers",
    unit: "listings",
    minValue: "1",
    maxValue: "500",
  });

  await seed({
    key: CONFIG_KEYS.BASIC_PAYOUT_DELAY_DAYS,
    value: "7",
    type: "INTEGER",
    category: "SELLER_TIERS",
    label: "Basic seller — payout delay",
    description: "Days before payout released for unverified sellers",
    unit: "days",
    minValue: "1",
    maxValue: "30",
  });

  await seed({
    key: CONFIG_KEYS.PHONE_PAYOUT_DELAY_DAYS,
    value: "3",
    type: "INTEGER",
    category: "SELLER_TIERS",
    label: "Phone-verified — payout delay",
    description: "Days before payout released for phone-verified sellers",
    unit: "days",
    minValue: "1",
    maxValue: "14",
  });

  await seed({
    key: CONFIG_KEYS.ID_PAYOUT_DELAY_DAYS,
    value: "1",
    type: "INTEGER",
    category: "SELLER_TIERS",
    label: "ID-verified — payout delay",
    description: "Days before payout released for ID-verified sellers",
    unit: "days",
    minValue: "1",
    maxValue: "7",
  });

  // ── FINANCIAL ───────────────────────────────────────────────────────────────

  await seed({
    key: CONFIG_KEYS.SHIPPING_SAME_REGION_CENTS,
    value: "600",
    type: "INTEGER",
    category: "FINANCIAL",
    label: "Shipping — same region",
    description: "Flat shipping rate within the same NZ region (NZD cents)",
    unit: "cents",
    minValue: "0",
    maxValue: "5000",
  });

  await seed({
    key: CONFIG_KEYS.SHIPPING_SAME_ISLAND_CENTS,
    value: "800",
    type: "INTEGER",
    category: "FINANCIAL",
    label: "Shipping — same island",
    description: "Flat shipping rate within the same NZ island (NZD cents)",
    unit: "cents",
    minValue: "0",
    maxValue: "5000",
  });

  await seed({
    key: CONFIG_KEYS.SHIPPING_INTER_ISLAND_CENTS,
    value: "1200",
    type: "INTEGER",
    category: "FINANCIAL",
    label: "Shipping — inter island",
    description: "Flat shipping rate between NZ islands (NZD cents)",
    unit: "cents",
    minValue: "0",
    maxValue: "10000",
  });

  await seed({
    key: CONFIG_KEYS.SHIPPING_RURAL_SURCHARGE_CENTS,
    value: "400",
    type: "INTEGER",
    category: "FINANCIAL",
    label: "Shipping — rural surcharge",
    description: "Additional cost for rural NZ deliveries (NZD cents)",
    unit: "cents",
    minValue: "0",
    maxValue: "3000",
  });

  await seed({
    key: CONFIG_KEYS.L1_MAX_PRICE_CENTS,
    value: "10000",
    type: "INTEGER",
    category: "FINANCIAL",
    label: "L1 seller — max listing price",
    description:
      "Maximum listing price for Level 1 unverified sellers (NZD cents)",
    unit: "cents",
    minValue: "100",
    maxValue: "100000",
  });

  await seed({
    key: CONFIG_KEYS.PLATFORM_MAX_PRICE_CENTS,
    value: "5000000",
    type: "INTEGER",
    category: "FINANCIAL",
    label: "Platform — absolute max price",
    description: "Absolute maximum listing price on the platform (NZD cents)",
    unit: "cents",
    minValue: "10000",
    maxValue: "100000000",
  });

  await seed({
    key: CONFIG_KEYS.ESCROW_RELEASE_BUSINESS_DAYS,
    value: "4",
    type: "INTEGER",
    category: "FINANCIAL",
    label: "Escrow — auto-release delay",
    description:
      "Business days after dispatch before escrow auto-releases if buyer hasn't confirmed",
    unit: "days",
    minValue: "1",
    maxValue: "30",
  });

  await seed({
    key: CONFIG_KEYS.OFFER_MIN_PERCENTAGE,
    value: "50",
    type: "DECIMAL",
    category: "FINANCIAL",
    label: "Offer — minimum % of asking price",
    description:
      "Lowest offer a buyer can submit as a percentage of listing price",
    unit: "%",
    minValue: "10",
    maxValue: "99",
  });

  // ── TIME_LIMITS ─────────────────────────────────────────────────────────────

  await seed({
    key: CONFIG_KEYS.FREE_CANCEL_WINDOW_MINUTES,
    value: "60",
    type: "INTEGER",
    category: "TIME_LIMITS",
    label: "Order — free cancel window",
    description:
      "Minutes after purchase a buyer can cancel for free without seller approval",
    unit: "minutes",
    minValue: "0",
    maxValue: "1440",
  });

  await seed({
    key: CONFIG_KEYS.CANCEL_REQUEST_WINDOW_HOURS,
    value: "24",
    type: "INTEGER",
    category: "TIME_LIMITS",
    label: "Order — cancel request window",
    description:
      "Hours after purchase a buyer can request cancellation (requires seller approval)",
    unit: "hours",
    minValue: "1",
    maxValue: "168",
  });

  await seed({
    key: CONFIG_KEYS.DISPUTE_OPEN_WINDOW_DAYS,
    value: "14",
    type: "INTEGER",
    category: "TIME_LIMITS",
    label: "Dispute — open window",
    description: "Days after dispatch within which a buyer can open a dispute",
    unit: "days",
    minValue: "3",
    maxValue: "60",
  });

  await seed({
    key: CONFIG_KEYS.DISPUTE_SELLER_RESPONSE_HOURS,
    value: "72",
    type: "INTEGER",
    category: "TIME_LIMITS",
    label: "Dispute — seller response deadline",
    description:
      "Hours seller has to respond to a dispute before auto-resolution runs",
    unit: "hours",
    minValue: "12",
    maxValue: "168",
  });

  await seed({
    key: CONFIG_KEYS.DISPUTE_COOLING_PERIOD_HOURS,
    value: "24",
    type: "INTEGER",
    category: "TIME_LIMITS",
    label: "Dispute — cooling period",
    description:
      "Hours between auto-resolution decision and execution (allows appeals)",
    unit: "hours",
    minValue: "0",
    maxValue: "72",
  });

  await seed({
    key: CONFIG_KEYS.RETURN_RESPONSE_WINDOW_HOURS,
    value: "72",
    type: "INTEGER",
    category: "TIME_LIMITS",
    label: "Returns — seller response window",
    description: "Hours seller has to respond to a return request",
    unit: "hours",
    minValue: "12",
    maxValue: "168",
  });

  await seed({
    key: CONFIG_KEYS.PARTIAL_REFUND_RESPONSE_HOURS,
    value: "48",
    type: "INTEGER",
    category: "TIME_LIMITS",
    label: "Partial refund — response window",
    description:
      "Hours the other party has to respond to a partial refund offer",
    unit: "hours",
    minValue: "12",
    maxValue: "168",
  });

  await seed({
    key: CONFIG_KEYS.CART_EXPIRY_HOURS,
    value: "48",
    type: "INTEGER",
    category: "TIME_LIMITS",
    label: "Cart — expiry",
    description: "Hours before an inactive cart is automatically cleared",
    unit: "hours",
    minValue: "1",
    maxValue: "168",
  });

  await seed({
    key: CONFIG_KEYS.OFFER_EXPIRY_HOURS,
    value: "72",
    type: "INTEGER",
    category: "TIME_LIMITS",
    label: "Offer — expiry",
    description: "Hours before an unaccepted offer expires automatically",
    unit: "hours",
    minValue: "12",
    maxValue: "168",
  });

  await seed({
    key: CONFIG_KEYS.TRUST_METRICS_CACHE_HOURS,
    value: "24",
    type: "INTEGER",
    category: "TIME_LIMITS",
    label: "Trust — metrics cache duration",
    description: "Hours trust metrics are cached before recalculating from DB",
    unit: "hours",
    minValue: "1",
    maxValue: "72",
  });

  await seed({
    key: CONFIG_KEYS.TRUST_SCORE_ROLLING_DAYS,
    value: "30",
    type: "INTEGER",
    category: "TIME_LIMITS",
    label: "Trust — score rolling window",
    description: "Days of order history used for trust score calculation",
    unit: "days",
    minValue: "7",
    maxValue: "365",
  });

  await seed({
    key: CONFIG_KEYS.SHIPPING_DELAY_NOTIFICATION_DAYS,
    value: "7",
    type: "INTEGER",
    category: "TIME_LIMITS",
    label: "Shipping — delay notification window",
    description: "Days before a shipping delay notification auto-closes",
    unit: "days",
    minValue: "1",
    maxValue: "30",
  });

  // ── LISTING_RULES ───────────────────────────────────────────────────────────

  await seed({
    key: CONFIG_KEYS.LISTING_MIN_TITLE_LENGTH,
    value: "5",
    type: "INTEGER",
    category: "LISTING_RULES",
    label: "Listing — min title length",
    description: "Minimum characters required in a listing title",
    unit: "chars",
    minValue: "3",
    maxValue: "20",
  });

  await seed({
    key: CONFIG_KEYS.LISTING_MAX_TITLE_LENGTH,
    value: "80",
    type: "INTEGER",
    category: "LISTING_RULES",
    label: "Listing — max title length",
    description: "Maximum characters allowed in a listing title",
    unit: "chars",
    minValue: "40",
    maxValue: "200",
  });

  await seed({
    key: CONFIG_KEYS.LISTING_MIN_DESCRIPTION_LENGTH,
    value: "50",
    type: "INTEGER",
    category: "LISTING_RULES",
    label: "Listing — min description length",
    description: "Minimum characters required in a listing description",
    unit: "chars",
    minValue: "10",
    maxValue: "200",
  });

  await seed({
    key: CONFIG_KEYS.LISTING_SHORT_DESC_THRESHOLD,
    value: "100",
    type: "INTEGER",
    category: "LISTING_RULES",
    label: "Listing — short description risk threshold",
    description:
      "Descriptions shorter than this length add risk score to the listing",
    unit: "chars",
    minValue: "20",
    maxValue: "500",
  });

  await seed({
    key: CONFIG_KEYS.LISTING_HIGH_VALUE_THRESHOLD_CENTS,
    value: "50000",
    type: "INTEGER",
    category: "LISTING_RULES",
    label: "Listing — high value threshold",
    description: "Listings priced above this trigger manual review (NZD cents)",
    unit: "cents",
    minValue: "1000",
    maxValue: "1000000",
  });

  await seed({
    key: CONFIG_KEYS.LISTING_L1_MAX_ACTIVE,
    value: "3",
    type: "INTEGER",
    category: "LISTING_RULES",
    label: "Listing — L1 seller max active",
    description: "Maximum simultaneous active listings for Level 1 sellers",
    unit: "listings",
    minValue: "1",
    maxValue: "20",
  });

  await seed({
    key: CONFIG_KEYS.LISTING_AUTO_PUBLISH_MAX_SCORE,
    value: "29",
    type: "INTEGER",
    category: "LISTING_RULES",
    label: "Listing — auto-publish score ceiling",
    description:
      "Listings scoring at or below this publish automatically without admin review",
    unit: "score",
    minValue: "0",
    maxValue: "100",
  });

  await seed({
    key: CONFIG_KEYS.LISTING_MAX_IMAGES,
    value: "10",
    type: "INTEGER",
    category: "LISTING_RULES",
    label: "Listing — max images",
    description: "Maximum number of images allowed per listing",
    unit: "images",
    minValue: "1",
    maxValue: "30",
  });

  await seed({
    key: CONFIG_KEYS.LISTING_DUPLICATE_WINDOW_DAYS,
    value: "7",
    type: "INTEGER",
    category: "LISTING_RULES",
    label: "Listing — duplicate detection window",
    description:
      "Days to look back when checking for duplicate listings from same seller",
    unit: "days",
    minValue: "1",
    maxValue: "30",
  });

  await seed({
    key: CONFIG_KEYS.LISTING_FIRST_LISTINGS_THRESHOLD,
    value: "3",
    type: "INTEGER",
    category: "LISTING_RULES",
    label: "Listing — first listings threshold",
    description:
      "Sellers with fewer approved listings than this get elevated risk score",
    unit: "listings",
    minValue: "1",
    maxValue: "20",
  });

  // ── FRAUD_RULES ─────────────────────────────────────────────────────────────

  await seed({
    key: CONFIG_KEYS.RISK_SCORE_SINGLE_IMAGE,
    value: "15",
    type: "INTEGER",
    category: "FRAUD_RULES",
    label: "Risk — single image",
    description: "Risk points added when listing has only one image",
    unit: "points",
    minValue: "0",
    maxValue: "100",
  });

  await seed({
    key: CONFIG_KEYS.RISK_SCORE_SHORT_DESC,
    value: "15",
    type: "INTEGER",
    category: "FRAUD_RULES",
    label: "Risk — short description",
    description:
      "Risk points added for descriptions under the short-desc threshold",
    unit: "points",
    minValue: "0",
    maxValue: "100",
  });

  await seed({
    key: CONFIG_KEYS.RISK_SCORE_PHONE_IN_LISTING,
    value: "45",
    type: "INTEGER",
    category: "FRAUD_RULES",
    label: "Risk — phone number detected",
    description:
      "Risk points added when a phone number pattern is found in the listing",
    unit: "points",
    minValue: "0",
    maxValue: "100",
  });

  await seed({
    key: CONFIG_KEYS.RISK_SCORE_EMAIL_IN_LISTING,
    value: "45",
    type: "INTEGER",
    category: "FRAUD_RULES",
    label: "Risk — email address detected",
    description:
      "Risk points added when an email address pattern is found in the listing",
    unit: "points",
    minValue: "0",
    maxValue: "100",
  });

  await seed({
    key: CONFIG_KEYS.RISK_SCORE_EXTERNAL_URL,
    value: "35",
    type: "INTEGER",
    category: "FRAUD_RULES",
    label: "Risk — external URL detected",
    description:
      "Risk points added when an external URL is found in the description",
    unit: "points",
    minValue: "0",
    maxValue: "100",
  });

  await seed({
    key: CONFIG_KEYS.RISK_SCORE_RISK_KEYWORD,
    value: "30",
    type: "INTEGER",
    category: "FRAUD_RULES",
    label: "Risk — risk keyword match",
    description:
      "Risk points added when a risk keyword is detected in the listing",
    unit: "points",
    minValue: "0",
    maxValue: "100",
  });

  await seed({
    key: CONFIG_KEYS.RISK_SCORE_HIGH_DISPUTE_RATE,
    value: "40",
    type: "INTEGER",
    category: "FRAUD_RULES",
    label: "Risk — high dispute rate seller",
    description:
      "Risk points added when listing is from a seller with a high dispute rate",
    unit: "points",
    minValue: "0",
    maxValue: "100",
  });

  await seed({
    key: CONFIG_KEYS.RISK_SCORE_NEW_SELLER,
    value: "20",
    type: "INTEGER",
    category: "FRAUD_RULES",
    label: "Risk — new seller",
    description: "Risk points added for all Level 1 unverified sellers",
    unit: "points",
    minValue: "0",
    maxValue: "100",
  });

  await seed({
    key: CONFIG_KEYS.RISK_SCORE_HIGH_VALUE,
    value: "50",
    type: "INTEGER",
    category: "FRAUD_RULES",
    label: "Risk — high value item",
    description:
      "Risk points added when listing price exceeds the high-value threshold",
    unit: "points",
    minValue: "0",
    maxValue: "100",
  });

  await seed({
    key: CONFIG_KEYS.RISK_SCORE_DUPLICATE,
    value: "50",
    type: "INTEGER",
    category: "FRAUD_RULES",
    label: "Risk — duplicate listing",
    description:
      "Risk points added when a near-duplicate listing from same seller is detected",
    unit: "points",
    minValue: "0",
    maxValue: "100",
  });

  await seed({
    key: CONFIG_KEYS.RISK_SCORE_FIRST_LISTINGS,
    value: "30",
    type: "INTEGER",
    category: "FRAUD_RULES",
    label: "Risk — first listings",
    description:
      "Risk points added for sellers with fewer than the first-listings threshold",
    unit: "points",
    minValue: "0",
    maxValue: "100",
  });

  await seed({
    key: CONFIG_KEYS.SELLER_HIGH_DISPUTE_RATE_PCT,
    value: "10",
    type: "DECIMAL",
    category: "FRAUD_RULES",
    label: "Seller — high dispute rate threshold",
    description:
      "Dispute rate % above which a seller is considered high-risk for listing review",
    unit: "%",
    minValue: "1",
    maxValue: "50",
  });

  await seed({
    key: CONFIG_KEYS.AUTO_REFUND_SCORE_THRESHOLD,
    value: "60",
    type: "INTEGER",
    category: "FRAUD_RULES",
    label: "Auto-resolve — refund threshold",
    description:
      "Dispute score at or above this triggers automatic refund to buyer",
    unit: "score",
    minValue: "10",
    maxValue: "200",
  });

  await seed({
    key: CONFIG_KEYS.AUTO_DISMISS_SCORE_THRESHOLD,
    value: "-40",
    type: "INTEGER",
    category: "FRAUD_RULES",
    label: "Auto-resolve — dismiss threshold",
    description: "Dispute score at or below this triggers automatic seller win",
    unit: "score",
    minValue: "-200",
    maxValue: "0",
  });

  await seed({
    key: CONFIG_KEYS.BUYER_FRAUD_DISPUTE_LIMIT,
    value: "5",
    type: "INTEGER",
    category: "FRAUD_RULES",
    label: "Buyer fraud — dispute limit",
    description:
      "Number of total disputes that flags a buyer account for fraud review",
    unit: "disputes",
    minValue: "2",
    maxValue: "20",
  });

  await seed({
    key: CONFIG_KEYS.SELLER_FRAUD_DISPUTE_RATE_PCT,
    value: "20",
    type: "DECIMAL",
    category: "FRAUD_RULES",
    label: "Seller fraud — dispute rate",
    description:
      "Dispute rate % above which a seller is flagged for fraud review",
    unit: "%",
    minValue: "5",
    maxValue: "80",
  });

  await seed({
    key: CONFIG_KEYS.BUYER_HUMAN_REVIEW_AFTER,
    value: "3",
    type: "INTEGER",
    category: "FRAUD_RULES",
    label: "Buyer — escalate to human after",
    description:
      "Number of disputes in rolling window before escalating to human review",
    unit: "disputes",
    minValue: "1",
    maxValue: "20",
  });

  await seed({
    key: CONFIG_KEYS.SELLER_DOWNGRADE_DISPUTE_RATE_PCT,
    value: "15",
    type: "DECIMAL",
    category: "FRAUD_RULES",
    label: "Seller downgrade — dispute rate threshold",
    description:
      "Dispute rate % above which a Gold/Silver seller is automatically downgraded",
    unit: "%",
    minValue: "5",
    maxValue: "80",
  });

  await seed({
    key: CONFIG_KEYS.SELLER_DOWNGRADE_OPEN_DISPUTES,
    value: "3",
    type: "INTEGER",
    category: "FRAUD_RULES",
    label: "Seller downgrade — simultaneous open disputes",
    description:
      "Number of simultaneously open disputes that triggers automatic downgrade",
    unit: "disputes",
    minValue: "1",
    maxValue: "20",
  });

  await seed({
    key: CONFIG_KEYS.DISPUTE_SELLER_UNRESPONSIVE_HOURS,
    value: "72",
    type: "INTEGER",
    category: "FRAUD_RULES",
    label: "Dispute — seller unresponsive threshold",
    description:
      "Hours after which a non-responding seller is flagged in dispute scoring",
    unit: "hours",
    minValue: "12",
    maxValue: "168",
  });

  await seed({
    key: CONFIG_KEYS.DISPUTE_SELLER_HIGH_RATE_PCT,
    value: "15",
    type: "DECIMAL",
    category: "FRAUD_RULES",
    label: "Dispute scoring — seller high rate %",
    description:
      "Dispute rate % used to flag SELLER_HIGH_DISPUTE_RATE in auto-resolution scoring",
    unit: "%",
    minValue: "1",
    maxValue: "80",
  });

  await seed({
    key: CONFIG_KEYS.DISPUTE_SELLER_HIGH_RATE_MIN_ORDERS,
    value: "5",
    type: "INTEGER",
    category: "FRAUD_RULES",
    label: "Dispute scoring — seller high rate min orders",
    description:
      "Minimum completed orders before seller dispute rate affects scoring",
    unit: "orders",
    minValue: "1",
    maxValue: "50",
  });

  await seed({
    key: CONFIG_KEYS.DISPUTE_BUYER_HIGH_DISPUTES_DAYS,
    value: "30",
    type: "INTEGER",
    category: "FRAUD_RULES",
    label: "Dispute scoring — buyer rolling window",
    description:
      "Days used when counting buyer disputes for BUYER_HIGH_DISPUTE_RATE factor",
    unit: "days",
    minValue: "7",
    maxValue: "365",
  });

  await seed({
    key: CONFIG_KEYS.DISPUTE_BUYER_HIGH_DISPUTES_COUNT,
    value: "5",
    type: "INTEGER",
    category: "FRAUD_RULES",
    label: "Dispute scoring — buyer high disputes count",
    description:
      "Number of disputes in rolling window that triggers BUYER_HIGH_DISPUTE_RATE",
    unit: "disputes",
    minValue: "1",
    maxValue: "20",
  });

  await seed({
    key: CONFIG_KEYS.DISPUTE_SELLER_LOW_RATE_PCT,
    value: "5",
    type: "DECIMAL",
    category: "FRAUD_RULES",
    label: "Dispute scoring — seller low rate %",
    description:
      "Dispute rate % below which SELLER_LOW_DISPUTE_RATE factor applies",
    unit: "%",
    minValue: "0",
    maxValue: "20",
  });

  await seed({
    key: CONFIG_KEYS.DISPUTE_SELLER_LOW_RATE_MIN_ORDERS,
    value: "5",
    type: "INTEGER",
    category: "FRAUD_RULES",
    label: "Dispute scoring — seller low rate min orders",
    description:
      "Minimum completed orders before SELLER_LOW_DISPUTE_RATE factor applies",
    unit: "orders",
    minValue: "1",
    maxValue: "50",
  });

  // ── PICKUP_RULES ────────────────────────────────────────────────────────────

  await seed({
    key: CONFIG_KEYS.PICKUP_MIN_LEAD_TIME_HOURS,
    value: "2",
    type: "INTEGER",
    category: "PICKUP_RULES",
    label: "Pickup — minimum lead time",
    description: "Minimum hours in advance a pickup time can be proposed",
    unit: "hours",
    minValue: "0",
    maxValue: "48",
  });

  await seed({
    key: CONFIG_KEYS.PICKUP_MAX_HORIZON_DAYS,
    value: "30",
    type: "INTEGER",
    category: "PICKUP_RULES",
    label: "Pickup — maximum scheduling horizon",
    description: "Maximum days in advance a pickup time can be scheduled",
    unit: "days",
    minValue: "1",
    maxValue: "90",
  });

  await seed({
    key: CONFIG_KEYS.PICKUP_WINDOW_MINUTES,
    value: "30",
    type: "INTEGER",
    category: "PICKUP_RULES",
    label: "Pickup — confirmation window",
    description:
      "Minutes after scheduled time within which seller must initiate OTP before no-show is triggered",
    unit: "minutes",
    minValue: "5",
    maxValue: "120",
  });

  await seed({
    key: CONFIG_KEYS.PICKUP_RESCHEDULE_LIMIT,
    value: "3",
    type: "INTEGER",
    category: "PICKUP_RULES",
    label: "Pickup — max reschedules",
    description:
      "Maximum reschedule attempts before force-cancel becomes eligible",
    unit: "reschedules",
    minValue: "1",
    maxValue: "10",
  });

  await seed({
    key: CONFIG_KEYS.PICKUP_RESCHEDULE_RESPONSE_HOURS,
    value: "12",
    type: "INTEGER",
    category: "PICKUP_RULES",
    label: "Pickup — reschedule response deadline",
    description:
      "Hours the other party has to respond to a reschedule request before auto-cancel",
    unit: "hours",
    minValue: "1",
    maxValue: "72",
  });

  await seed({
    key: CONFIG_KEYS.PICKUP_SCHEDULE_DEADLINE_HOURS,
    value: "48",
    type: "INTEGER",
    category: "PICKUP_RULES",
    label: "Pickup — schedule agreement deadline",
    description:
      "Hours after order creation to agree a pickup time before auto-cancel",
    unit: "hours",
    minValue: "12",
    maxValue: "168",
  });

  await seed({
    key: CONFIG_KEYS.PICKUP_OTP_EXPIRY_MINUTES,
    value: "30",
    type: "INTEGER",
    category: "PICKUP_RULES",
    label: "Pickup OTP — expiry",
    description: "Minutes a pickup OTP code remains valid after being sent",
    unit: "minutes",
    minValue: "5",
    maxValue: "60",
  });

  await seed({
    key: CONFIG_KEYS.PICKUP_OTP_EARLY_INITIATION_MINUTES,
    value: "15",
    type: "INTEGER",
    category: "PICKUP_RULES",
    label: "Pickup OTP — early initiation window",
    description:
      "Minutes before scheduled time seller can initiate OTP confirmation",
    unit: "minutes",
    minValue: "0",
    maxValue: "60",
  });

  console.log("[PlatformConfig] Seeded 76 configuration keys");
}
