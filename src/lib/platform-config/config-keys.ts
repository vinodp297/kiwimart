// src/lib/platform-config/config-keys.ts
// ─── Platform Configuration Key Registry ────────────────────────────────────
// Every configurable business rule has a unique dot-notation key.
// Keys are grouped by ConfigCategory enum from the Prisma schema.

export const CONFIG_KEYS = {
  // ── SELLER_TIERS ───────────────────────────────────────────────────────────
  GOLD_MIN_SALES: "seller.tier.gold.min_sales",
  GOLD_MIN_RATING: "seller.tier.gold.min_rating",
  GOLD_MIN_COMPLETION_RATE: "seller.tier.gold.min_completion_rate",
  SILVER_MIN_SALES: "seller.tier.silver.min_sales",
  SILVER_MIN_RATING: "seller.tier.silver.min_rating",
  SILVER_MIN_COMPLETION_RATE: "seller.tier.silver.min_completion_rate",
  BRONZE_MIN_SALES: "seller.tier.bronze.min_sales",
  BRONZE_MIN_RATING: "seller.tier.bronze.min_rating",
  BRONZE_MIN_COMPLETION_RATE: "seller.tier.bronze.min_completion_rate",
  BASIC_MAX_LISTINGS: "seller.tier.basic.max_listings",
  PHONE_MAX_LISTINGS: "seller.tier.phone.max_listings",
  BASIC_PAYOUT_DELAY_DAYS: "seller.tier.basic.payout_delay_days",
  PHONE_PAYOUT_DELAY_DAYS: "seller.tier.phone.payout_delay_days",
  ID_PAYOUT_DELAY_DAYS: "seller.tier.id.payout_delay_days",

  // ── FINANCIAL ──────────────────────────────────────────────────────────────
  SHIPPING_SAME_REGION_CENTS: "financial.shipping.same_region_cents",
  SHIPPING_SAME_ISLAND_CENTS: "financial.shipping.same_island_cents",
  SHIPPING_INTER_ISLAND_CENTS: "financial.shipping.inter_island_cents",
  SHIPPING_RURAL_SURCHARGE_CENTS: "financial.shipping.rural_surcharge_cents",
  L1_MAX_PRICE_CENTS: "financial.seller.l1_max_price_cents",
  PLATFORM_MAX_PRICE_CENTS: "financial.listing.max_price_cents",
  ESCROW_RELEASE_BUSINESS_DAYS: "financial.escrow.release_business_days",
  OFFER_MIN_PERCENTAGE: "financial.offer.min_percentage",

  // ── TIME_LIMITS ────────────────────────────────────────────────────────────
  FREE_CANCEL_WINDOW_MINUTES: "time.order.free_cancel_window_minutes",
  CANCEL_REQUEST_WINDOW_HOURS: "time.order.cancel_request_window_hours",
  DISPUTE_OPEN_WINDOW_DAYS: "time.dispute.open_window_days",
  DISPUTE_SELLER_RESPONSE_HOURS: "time.dispute.seller_response_hours",
  DISPUTE_COOLING_PERIOD_HOURS: "time.dispute.cooling_period_hours",
  RETURN_RESPONSE_WINDOW_HOURS: "time.order.return_response_hours",
  PARTIAL_REFUND_RESPONSE_HOURS: "time.order.partial_refund_response_hours",
  CART_EXPIRY_HOURS: "time.cart.expiry_hours",
  OFFER_EXPIRY_HOURS: "time.offer.expiry_hours",
  TRUST_METRICS_CACHE_HOURS: "time.trust.cache_hours",
  TRUST_SCORE_ROLLING_DAYS: "time.trust.rolling_window_days",
  SHIPPING_DELAY_NOTIFICATION_DAYS:
    "time.order.shipping_delay_notification_days",

  // ── LISTING_RULES ──────────────────────────────────────────────────────────
  LISTING_MIN_TITLE_LENGTH: "listing.validation.min_title_length",
  LISTING_MAX_TITLE_LENGTH: "listing.validation.max_title_length",
  LISTING_MIN_DESCRIPTION_LENGTH: "listing.validation.min_description_length",
  LISTING_SHORT_DESC_THRESHOLD: "listing.validation.short_desc_risk_threshold",
  LISTING_HIGH_VALUE_THRESHOLD_CENTS:
    "listing.review.high_value_threshold_cents",
  LISTING_L1_MAX_ACTIVE: "listing.seller.l1_max_active_listings",
  LISTING_AUTO_PUBLISH_MAX_SCORE: "listing.review.auto_publish_max_score",
  LISTING_MAX_IMAGES: "listing.images.max_count",
  LISTING_DUPLICATE_WINDOW_DAYS: "listing.review.duplicate_window_days",
  LISTING_FIRST_LISTINGS_THRESHOLD: "listing.review.first_listings_threshold",

  // ── FRAUD_RULES ────────────────────────────────────────────────────────────
  RISK_SCORE_SINGLE_IMAGE: "fraud.risk.single_image",
  RISK_SCORE_SHORT_DESC: "fraud.risk.short_description",
  RISK_SCORE_PHONE_IN_LISTING: "fraud.risk.phone_in_listing",
  RISK_SCORE_EMAIL_IN_LISTING: "fraud.risk.email_in_listing",
  RISK_SCORE_EXTERNAL_URL: "fraud.risk.external_url",
  RISK_SCORE_RISK_KEYWORD: "fraud.risk.risk_keyword",
  RISK_SCORE_HIGH_DISPUTE_RATE: "fraud.risk.high_dispute_rate",
  RISK_SCORE_NEW_SELLER: "fraud.risk.new_seller",
  RISK_SCORE_HIGH_VALUE: "fraud.risk.high_value_item",
  RISK_SCORE_DUPLICATE: "fraud.risk.duplicate_listing",
  RISK_SCORE_FIRST_LISTINGS: "fraud.risk.first_listings",
  SELLER_HIGH_DISPUTE_RATE_PCT: "fraud.seller.high_dispute_rate_pct",
  AUTO_REFUND_SCORE_THRESHOLD: "fraud.dispute.auto_refund_threshold",
  AUTO_DISMISS_SCORE_THRESHOLD: "fraud.dispute.auto_dismiss_threshold",
  BUYER_FRAUD_DISPUTE_LIMIT: "fraud.buyer.fraud_dispute_limit",
  SELLER_FRAUD_DISPUTE_RATE_PCT: "fraud.seller.fraud_dispute_rate_pct",
  BUYER_HUMAN_REVIEW_AFTER: "fraud.buyer.human_review_after_disputes",
  SELLER_DOWNGRADE_DISPUTE_RATE_PCT: "fraud.seller.downgrade_dispute_rate_pct",
  SELLER_DOWNGRADE_OPEN_DISPUTES: "fraud.seller.downgrade_open_disputes_count",
  DISPUTE_SELLER_UNRESPONSIVE_HOURS: "fraud.dispute.seller_unresponsive_hours",
  DISPUTE_SELLER_HIGH_RATE_PCT: "fraud.dispute.seller_high_rate_pct",
  DISPUTE_SELLER_HIGH_RATE_MIN_ORDERS:
    "fraud.dispute.seller_high_rate_min_orders",
  DISPUTE_BUYER_HIGH_DISPUTES_DAYS: "fraud.dispute.buyer_high_disputes_days",
  DISPUTE_BUYER_HIGH_DISPUTES_COUNT: "fraud.dispute.buyer_high_disputes_count",
  DISPUTE_SELLER_LOW_RATE_PCT: "fraud.dispute.seller_low_rate_pct",
  DISPUTE_SELLER_LOW_RATE_MIN_ORDERS:
    "fraud.dispute.seller_low_rate_min_orders",

  // ── PICKUP_RULES ───────────────────────────────────────────────────────────
  PICKUP_MIN_LEAD_TIME_HOURS: "pickup.scheduling.min_lead_time_hours",
  PICKUP_MAX_HORIZON_DAYS: "pickup.scheduling.max_horizon_days",
  PICKUP_WINDOW_MINUTES: "pickup.scheduling.confirmation_window_minutes",
  PICKUP_RESCHEDULE_LIMIT: "pickup.scheduling.max_reschedules",
  PICKUP_RESCHEDULE_RESPONSE_HOURS:
    "pickup.scheduling.reschedule_response_hours",
  PICKUP_SCHEDULE_DEADLINE_HOURS: "pickup.scheduling.schedule_deadline_hours",
  PICKUP_OTP_EXPIRY_MINUTES: "pickup.otp.expiry_minutes",
  PICKUP_OTP_EARLY_INITIATION_MINUTES: "pickup.otp.early_initiation_minutes",
} as const;

export type ConfigKey = (typeof CONFIG_KEYS)[keyof typeof CONFIG_KEYS];
