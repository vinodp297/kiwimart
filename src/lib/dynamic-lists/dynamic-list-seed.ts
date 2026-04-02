// src/lib/dynamic-lists/dynamic-list-seed.ts
// ─── Dynamic List Seed ─────────────────────────────────────────────────────
// Seeds all 14 list types with production defaults. Uses upsert with empty
// update so admin-set values are never overwritten.

import type { PrismaClient, DynamicListType } from "@prisma/client";
import dbDefault from "@/lib/db";

interface SeedItem {
  value: string;
  label?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

async function seedList(
  db: PrismaClient,
  listType: DynamicListType,
  items: SeedItem[],
) {
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    await (
      db.dynamicListItem as unknown as {
        upsert: (args: unknown) => Promise<unknown>;
      }
    ).upsert({
      where: {
        listType_value: { listType, value: item.value },
      },
      create: {
        listType,
        value: item.value,
        label: item.label ?? null,
        description: item.description ?? null,
        metadata: (item.metadata ?? undefined) as unknown,
        sortOrder: i,
        active: true,
      },
      update: {},
    });
  }
}

export async function seedDynamicLists(
  dbOverride?: PrismaClient,
): Promise<void> {
  const db = (dbOverride ?? dbDefault) as PrismaClient;

  // ── BANNED_KEYWORDS ─────────────────────────────────────────────────────
  await seedList(db, "BANNED_KEYWORDS", [
    // Weapons
    { value: "gun" },
    { value: "firearm" },
    { value: "pistol" },
    { value: "rifle" },
    { value: "ammunition" },
    { value: "ammo" },
    { value: "silencer" },
    { value: "suppressor" },
    { value: "explosive" },
    { value: "grenade" },
    { value: "bomb" },
    // Drugs
    { value: "cocaine" },
    { value: "meth" },
    { value: "heroin" },
    { value: "fentanyl" },
    { value: "mdma" },
    { value: "ecstasy" },
    { value: "narcotics" },
    // Counterfeit signals
    { value: "replica" },
    { value: "fake" },
    { value: "knockoff" },
    { value: "counterfeit" },
    { value: "imitation" },
    { value: "copy of" },
    { value: "bootleg" },
    // Prohibited services
    { value: "escort" },
    { value: "prostitution" },
    { value: "adult service" },
    // Scam signals
    { value: "western union" },
    { value: "moneygram" },
    { value: "wire transfer only" },
    { value: "gift card payment" },
    { value: "bitcoin payment only" },
    // Contact bypass
    { value: "whatsapp me" },
    { value: "call me on" },
    { value: "text me on" },
    { value: "dm me" },
    { value: "message me outside" },
  ]);

  // ── RISK_KEYWORDS ───────────────────────────────────────────────────────
  await seedList(db, "RISK_KEYWORDS", [
    { value: "cannabis" },
    { value: "weed" },
    { value: "marijuana" },
    { value: "drug" },
  ]);

  // ── NZ_REGIONS ──────────────────────────────────────────────────────────
  await seedList(db, "NZ_REGIONS", [
    { value: "Auckland", metadata: { lat: -36.8485, lng: 174.7633 } },
    { value: "Wellington", metadata: { lat: -41.2865, lng: 174.7762 } },
    { value: "Canterbury", metadata: { lat: -43.5321, lng: 172.6362 } },
    { value: "Waikato", metadata: { lat: -37.787, lng: 175.2793 } },
    { value: "Bay of Plenty", metadata: { lat: -37.6878, lng: 176.1651 } },
    { value: "Otago", metadata: { lat: -45.8788, lng: 170.5028 } },
    { value: "Hawke's Bay", metadata: { lat: -39.4928, lng: 176.912 } },
    {
      value: "Manawat\u016b-Whanganui",
      metadata: { lat: -39.9307, lng: 175.0597 },
    },
    { value: "Northland", metadata: { lat: -35.7275, lng: 174.3166 } },
    { value: "Tasman", metadata: { lat: -41.2706, lng: 172.9081 } },
    { value: "Nelson", metadata: { lat: -41.2706, lng: 173.284 } },
    { value: "Marlborough", metadata: { lat: -41.5134, lng: 173.9612 } },
    { value: "Southland", metadata: { lat: -46.4132, lng: 168.3538 } },
    { value: "Taranaki", metadata: { lat: -39.0556, lng: 174.0752 } },
    { value: "Gisborne", metadata: { lat: -38.6623, lng: 178.0176 } },
    { value: "West Coast", metadata: { lat: -42.4504, lng: 171.2108 } },
  ]);

  // ── COURIERS ────────────────────────────────────────────────────────────
  await seedList(db, "COURIERS", [
    { value: "NZ Post" },
    { value: "CourierPost" },
    { value: "Aramex" },
    { value: "Post Haste" },
    { value: "Castle Parcels" },
    { value: "Other" },
  ]);

  // ── DISPUTE_REASONS ─────────────────────────────────────────────────────
  await seedList(db, "DISPUTE_REASONS", [
    {
      value: "ITEM_NOT_RECEIVED",
      label: "Item not received",
      description:
        "Verify tracking info. If delivered, request proof of delivery from courier.",
    },
    {
      value: "ITEM_NOT_AS_DESCRIBED",
      label: "Item not as described",
      description:
        "Compare listing photos/description with buyer evidence photos.",
    },
    {
      value: "ITEM_DAMAGED",
      label: "Item damaged",
      description:
        "Check packaging photos and whether insurance was purchased.",
    },
    {
      value: "WRONG_ITEM_SENT",
      label: "Wrong item sent",
      description: "Verify with listing snapshot. Arrange return if confirmed.",
    },
    {
      value: "COUNTERFEIT_ITEM",
      label: "Counterfeit item",
      description:
        "Escalate to Trust & Safety. May require expert verification.",
    },
    {
      value: "SELLER_UNRESPONSIVE",
      label: "Seller unresponsive",
      description:
        "Check seller last-active date and message history. Auto-resolve if 72h+ silence.",
    },
    {
      value: "SELLER_CANCELLED",
      label: "Seller cancelled",
      description:
        "Verify cancellation reason. Process full refund if seller initiated.",
    },
    {
      value: "REFUND_NOT_PROCESSED",
      label: "Refund not processed",
      description:
        "Check Stripe dashboard for refund status. Reissue if stuck.",
    },
    {
      value: "OTHER",
      label: "Other",
      description: "Review case details and apply best judgment.",
    },
  ]);

  // ── LISTING_CONDITIONS ──────────────────────────────────────────────────
  await seedList(db, "LISTING_CONDITIONS", [
    {
      value: "NEW",
      label: "Brand new",
      description: "Unused, unopened, in original packaging",
      metadata: { colour: "bg-emerald-100 text-emerald-800" },
    },
    {
      value: "LIKE_NEW",
      label: "Like new",
      description: "Used once or twice, no signs of wear",
      metadata: { colour: "bg-sky-100 text-sky-800" },
    },
    {
      value: "GOOD",
      label: "Good",
      description: "Some signs of use but fully functional",
      metadata: { colour: "bg-amber-100 text-amber-800" },
    },
    {
      value: "FAIR",
      label: "Fair",
      description: "Noticeable wear but still works",
      metadata: { colour: "bg-orange-100 text-orange-800" },
    },
    {
      value: "PARTS",
      label: "For parts",
      description: "Not fully functional, sold for parts or repair",
      metadata: { colour: "bg-red-100 text-red-800" },
    },
  ]);

  // ── REVIEW_TAGS ─────────────────────────────────────────────────────────
  await seedList(db, "REVIEW_TAGS", [
    {
      value: "FAST_SHIPPING",
      label: "Fast shipping",
      metadata: {
        emoji: "\u{1F680}",
        colour: "bg-sky-50 text-sky-700 border-sky-200",
      },
    },
    {
      value: "GREAT_PACKAGING",
      label: "Great packaging",
      metadata: {
        emoji: "\u{1F4E6}",
        colour: "bg-violet-50 text-violet-700 border-violet-200",
      },
    },
    {
      value: "ACCURATE_DESCRIPTION",
      label: "Accurate description",
      metadata: {
        emoji: "\u2705",
        colour: "bg-emerald-50 text-emerald-700 border-emerald-200",
      },
    },
    {
      value: "QUICK_COMMUNICATION",
      label: "Quick comms",
      metadata: {
        emoji: "\u{1F4AC}",
        colour: "bg-indigo-50 text-indigo-700 border-indigo-200",
      },
    },
    {
      value: "FAIR_PRICING",
      label: "Fair pricing",
      metadata: {
        emoji: "\u{1F4B0}",
        colour: "bg-amber-50 text-amber-700 border-amber-200",
      },
    },
    {
      value: "AS_DESCRIBED",
      label: "Item as described",
      metadata: {
        emoji: "\u{1F3AF}",
        colour: "bg-teal-50 text-teal-700 border-teal-200",
      },
    },
  ]);

  // ── REPORT_REASONS ──────────────────────────────────────────────────────
  await seedList(db, "REPORT_REASONS", [
    {
      value: "SCAM",
      label: "Suspected scam",
      description:
        "Seller is asking for payment outside the platform or seems fraudulent",
    },
    {
      value: "COUNTERFEIT",
      label: "Counterfeit / fake brand",
      description: "Listing is selling counterfeit or fake branded goods",
    },
    {
      value: "PROHIBITED",
      label: "Prohibited item",
      description: "Item is illegal or against platform policy",
    },
    {
      value: "OFFENSIVE",
      label: "Offensive content",
      description:
        "Listing contains hateful, violent, or inappropriate content",
    },
    {
      value: "SPAM",
      label: "Spam or duplicate",
      description: "Same item posted repeatedly or misleading listing",
    },
    {
      value: "OTHER",
      label: "Other",
      description: "Something else not listed above",
    },
  ]);

  // ── SELLER_RESCHEDULE_REASONS ───────────────────────────────────────────
  await seedList(db, "SELLER_RESCHEDULE_REASONS", [
    { value: "ITEM_NOT_READY", label: "Item not ready" },
    {
      value: "UNAVAILABLE_AT_AGREED_TIME",
      label: "Unavailable at agreed time",
    },
    { value: "LOCATION_OR_ADDRESS_ISSUE", label: "Location or address issue" },
    {
      value: "FAMILY_OR_PERSONAL_EMERGENCY",
      label: "Family or personal emergency",
    },
    { value: "OTHER", label: "Other" },
  ]);

  // ── BUYER_RESCHEDULE_REASONS ────────────────────────────────────────────
  await seedList(db, "BUYER_RESCHEDULE_REASONS", [
    {
      value: "UNAVAILABLE_AT_AGREED_TIME",
      label: "Unavailable at agreed time",
    },
    { value: "TRANSPORT_OR_TRAVEL_ISSUE", label: "Transport or travel issue" },
    { value: "CHANGED_PICKUP_LOCATION", label: "Changed pickup location" },
    {
      value: "FAMILY_OR_PERSONAL_EMERGENCY",
      label: "Family or personal emergency",
    },
    { value: "OTHER", label: "Other" },
  ]);

  // ── PICKUP_REJECT_REASONS ───────────────────────────────────────────────
  await seedList(db, "PICKUP_REJECT_REASONS", [
    { value: "ITEM_NOT_AS_DESCRIBED", label: "Item not as described" },
    { value: "ITEM_DAMAGED", label: "Item is damaged" },
    {
      value: "ITEM_NOT_PRESENT",
      label: "Item not present / seller didn't bring it",
    },
    {
      value: "SIGNIFICANTLY_DIFFERENT",
      label: "Item significantly different from photos",
    },
    { value: "OTHER", label: "Other" },
  ]);

  // ── DELIVERY_ISSUE_TYPES ────────────────────────────────────────────────
  await seedList(db, "DELIVERY_ISSUE_TYPES", [
    { value: "NOT_RECEIVED", label: "Not received" },
    { value: "ITEM_DAMAGED", label: "Item damaged in transit" },
    { value: "WRONG_ITEM", label: "Wrong item sent" },
    { value: "MISSING_PARTS", label: "Missing parts or accessories" },
    { value: "NOT_AS_DESCRIBED", label: "Not as described" },
  ]);

  // ── PROBLEM_TYPES ───────────────────────────────────────────────────────
  await seedList(db, "PROBLEM_TYPES", [
    {
      value: "CANCEL",
      label: "I want to cancel my order",
      description: "We'll process your cancellation request",
      metadata: { needsPhotos: false, needsAmount: false },
    },
    {
      value: "SELLER_NOT_SHIPPING",
      label: "The seller hasn't shipped yet",
      description: "We'll check the expected dispatch timeline",
      metadata: { needsPhotos: false, needsAmount: false },
    },
    {
      value: "NOT_RECEIVED",
      label: "I haven't received my item",
      description: "We'll check the tracking status and help you",
      metadata: { needsPhotos: false, needsAmount: false },
    },
    {
      value: "ITEM_DAMAGED",
      label: "The item arrived damaged",
      description: "Upload photos so we can help resolve this",
      metadata: { needsPhotos: true, needsAmount: false },
    },
    {
      value: "NOT_AS_DESCRIBED",
      label: "It's not what was described",
      description: "Upload photos showing the difference",
      metadata: { needsPhotos: true, needsAmount: false },
    },
    {
      value: "WRONG_ITEM",
      label: "I received the wrong item",
      description: "Upload photos of what you received",
      metadata: { needsPhotos: true, needsAmount: false },
    },
    {
      value: "MISSING_PARTS",
      label: "Missing parts or accessories",
      description: "Tell us what's missing",
      metadata: { needsPhotos: false, needsAmount: false },
    },
    {
      value: "CHANGED_MIND",
      label: "I changed my mind",
      description: "Request a return within 7 days",
      metadata: { needsPhotos: false, needsAmount: false },
    },
    {
      value: "PARTIAL_REFUND",
      label: "I want a partial refund",
      description: "Request a partial refund for the issue",
      metadata: { needsPhotos: false, needsAmount: true },
    },
  ]);

  // ── QUICK_FILTER_CHIPS ──────────────────────────────────────────────────
  await seedList(db, "QUICK_FILTER_CHIPS", [
    {
      value: "isUrgent",
      label: "Urgent sale",
      metadata: { emoji: "\u{1F525}" },
    },
    {
      value: "isNegotiable",
      label: "Negotiable price",
      metadata: { emoji: "\u{1F4AC}" },
    },
    {
      value: "shipsNationwide",
      label: "Ships NZ wide",
      metadata: { emoji: "\u{1F4E6}" },
    },
    {
      value: "verifiedOnly",
      label: "Verified sellers",
      metadata: { emoji: "\u2705" },
    },
  ]);

  console.log("Dynamic lists seeded (14 list types).");
}
