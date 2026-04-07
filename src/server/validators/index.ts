// src/server/validators/index.ts
// ─── Zod Validation Schemas ───────────────────────────────────────────────────
// Single source of truth: these schemas are used for:
//   1. Server action input validation (prevents injection, enforces constraints)
//   2. Client-side React Hook Form validation (via zodResolver)
//   3. Type inference (no separate TypeScript interface needed)
//
// Naming convention: <Entity><Action>Schema
// Type exports:      <Entity><Action>Input (inferred from schema)
//
// NEVER import these in client components without checking bundle size.
// All schema code is tree-shaken in production builds.

import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Shared field validators
// ─────────────────────────────────────────────────────────────────────────────

const emailField = z
  .string()
  .min(1, "Email is required")
  .email("Enter a valid email address")
  .max(254, "Email is too long")
  .toLowerCase()
  .trim();

const passwordField = z
  .string()
  .min(12, "Password must be at least 12 characters")
  .max(128, "Password is too long")
  .regex(/[A-Z]/, "Must contain at least one uppercase letter")
  .regex(/[a-z]/, "Must contain at least one lowercase letter")
  .regex(/[0-9]/, "Must contain at least one number");

// Exported standalone so service-layer code (e.g. auth.service.ts resetPassword)
// can validate the same strength rules without re-defining them.
export const passwordSchema = passwordField;

const usernameField = z
  .string()
  .min(3, "Username must be at least 3 characters")
  .max(30, "Username must be 30 characters or less")
  .regex(
    /^[a-zA-Z0-9_-]+$/,
    "Username can only contain letters, numbers, underscores and hyphens",
  )
  .trim();

const nzRegionField = z.enum([
  "Auckland",
  "Wellington",
  "Canterbury",
  "Waikato",
  "Bay of Plenty",
  "Otago",
  "Hawke's Bay",
  "Manawatū-Whanganui",
  "Northland",
  "Tasman",
  "Nelson",
  "Marlborough",
  "Southland",
  "Taranaki",
  "Gisborne",
  "West Coast",
] as const);

// ─────────────────────────────────────────────────────────────────────────────
// Auth schemas
// ─────────────────────────────────────────────────────────────────────────────

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, "Password is required").max(128),
  turnstileToken: z.string().default(""),
  rememberMe: z.coerce.boolean().default(false),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const registerSchema = z
  .object({
    firstName: z
      .string()
      .min(1, "First name is required")
      .max(50, "First name is too long")
      .trim(),
    lastName: z
      .string()
      .min(1, "Last name is required")
      .max(50, "Last name is too long")
      .trim(),
    email: emailField,
    username: usernameField,
    password: passwordField,
    confirmPassword: z.string().min(1, "Please confirm your password"),
    agreeTerms: z.literal<true>(true),
    hasMarketingConsent: z.boolean().default(false),
    turnstileToken: z.string().default(""),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
export type RegisterInput = z.infer<typeof registerSchema>;

export const forgotPasswordSchema = z.object({
  email: emailField,
  turnstileToken: z.string().default(""),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    token: z.string().min(1, "Reset token is required"),
    password: passwordField,
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Listing schemas
// ─────────────────────────────────────────────────────────────────────────────

const conditionEnum = z.enum(["NEW", "LIKE_NEW", "GOOD", "FAIR", "PARTS"]);
const shippingEnum = z.enum(["PICKUP", "COURIER", "BOTH"]);

export const createListingSchema = z.object({
  title: z
    .string()
    .min(5, "Title must be at least 5 characters")
    .max(100, "Title must be 100 characters or less")
    .trim(),
  description: z
    .string()
    .min(20, "Description must be at least 20 characters")
    .max(3000, "Description must be 3000 characters or less")
    .trim(),
  categoryId: z.string().min(1, "Category is required"),
  subcategoryName: z.string().max(50).optional(),
  // Condition — accepts both "LIKE_NEW" enum and "like-new" form format
  condition: z
    .string()
    .transform((v) => {
      // Convert form format "like-new" → "LIKE_NEW" for the DB enum
      const mapped: Record<string, string> = {
        new: "NEW",
        NEW: "NEW",
        "like-new": "LIKE_NEW",
        "LIKE-NEW": "LIKE_NEW",
        LIKE_NEW: "LIKE_NEW",
        good: "GOOD",
        GOOD: "GOOD",
        fair: "FAIR",
        FAIR: "FAIR",
        parts: "PARTS",
        PARTS: "PARTS",
      };
      return mapped[v] ?? v;
    })
    .pipe(conditionEnum),
  // Price in NZD (dollars, not cents) — server converts to cents.
  // Accepts string or number since the form may send either.
  price: z
    .union([z.string(), z.number()])
    .transform((v) => (typeof v === "string" ? Number(v) : v))
    .pipe(
      z
        .number({ error: "Price must be a number" })
        .positive("Price must be greater than $0")
        .max(100_000, "Maximum price is $100,000"),
    ),
  isOffersEnabled: z.boolean().default(true),
  isGstIncluded: z.boolean().default(false),
  isUrgent: z.boolean().default(false),
  isNegotiable: z.boolean().default(false),
  shipsNationwide: z.boolean().default(false),
  // Shipping option — accepts both "PICKUP" enum and "pickup" form format
  shippingOption: z
    .string()
    .transform((v) => v.toUpperCase())
    .pipe(shippingEnum),
  // Shipping price in NZD dollars (0 = free, null = not applicable).
  // Accepts string, number, or undefined since the form may send any.
  shippingPrice: z
    .union([z.string(), z.number(), z.undefined()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === null || v === "") return 0;
      return typeof v === "string" ? Number(v) : v;
    })
    .pipe(
      z
        .number()
        .min(0, "Shipping price can't be negative")
        .max(500, "Maximum shipping price is $500"),
    ),
  pickupAddress: z.string().max(200).optional(),
  region: nzRegionField,
  suburb: z.string().min(1, "Suburb is required").max(100).trim(),
  attributes: z
    .array(
      z.object({
        label: z.string().max(50).trim(),
        value: z.string().max(200).trim(),
      }),
    )
    .max(20)
    .default([]),
  // Image R2 keys — validated for existence in the action
  imageKeys: z
    .array(z.string().max(200))
    .min(1, "At least one photo is required")
    .max(10),
});
export type CreateListingInput = z.infer<typeof createListingSchema>;

export const updateListingSchema = createListingSchema.partial().extend({
  listingId: z.string().min(1),
});
export type UpdateListingInput = z.infer<typeof updateListingSchema>;

// Draft schema — all fields optional except the ones we have.
// Drafts can be saved at any point during the wizard so nothing is required.
export const saveDraftSchema = z.object({
  draftId: z.string().optional(), // existing draft to update
  title: z.string().max(100).optional(),
  description: z.string().max(3000).optional(),
  categoryId: z.string().optional(),
  subcategoryName: z.string().max(50).optional(),
  condition: z
    .string()
    .transform((v) => {
      const mapped: Record<string, string> = {
        new: "NEW",
        NEW: "NEW",
        "like-new": "LIKE_NEW",
        "LIKE-NEW": "LIKE_NEW",
        LIKE_NEW: "LIKE_NEW",
        good: "GOOD",
        GOOD: "GOOD",
        fair: "FAIR",
        FAIR: "FAIR",
        parts: "PARTS",
        PARTS: "PARTS",
      };
      return mapped[v] ?? v;
    })
    .pipe(conditionEnum)
    .optional(),
  price: z
    .union([z.string(), z.number(), z.undefined()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === null || v === "") return undefined;
      return typeof v === "string" ? Number(v) : v;
    })
    .pipe(z.number().min(0).max(100_000).optional()),
  isOffersEnabled: z.boolean().optional(),
  isGstIncluded: z.boolean().optional(),
  isUrgent: z.boolean().optional(),
  isNegotiable: z.boolean().optional(),
  shipsNationwide: z.boolean().optional(),
  shippingOption: z
    .string()
    .transform((v) => v.toUpperCase())
    .pipe(shippingEnum)
    .optional(),
  shippingPrice: z
    .union([z.string(), z.number(), z.undefined()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === null || v === "") return undefined;
      return typeof v === "string" ? Number(v) : v;
    })
    .pipe(z.number().min(0).max(500).optional()),
  pickupAddress: z.string().max(200).optional(),
  region: nzRegionField.optional(),
  suburb: z.string().max(100).optional(),
  imageKeys: z.array(z.string().max(200)).max(10).optional(),
});
export type SaveDraftInput = z.infer<typeof saveDraftSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Offer schema
// ─────────────────────────────────────────────────────────────────────────────

export const createOfferSchema = z.object({
  listingId: z.string().min(1),
  // Amount in NZD dollars — server validates against listing price
  amount: z
    .number()
    .positive("Offer amount must be greater than $0")
    .max(100_000),
  note: z.string().max(300).optional(),
});
export type CreateOfferInput = z.infer<typeof createOfferSchema>;

export const respondOfferSchema = z.object({
  offerId: z.string().min(1),
  action: z.enum(["ACCEPT", "DECLINE"]),
  declineReason: z.string().max(300).optional(),
});
export type RespondOfferInput = z.infer<typeof respondOfferSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Message schema
// ─────────────────────────────────────────────────────────────────────────────

export const sendMessageSchema = z.object({
  threadId: z.string().min(1).optional(),
  recipientId: z.string().min(1),
  listingId: z.string().min(1).optional(),
  body: z
    .string()
    .min(1, "Message cannot be empty")
    .max(1000, "Message must be 1000 characters or less")
    .trim(),
});
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Review schema
// ─────────────────────────────────────────────────────────────────────────────

const reviewTagEnum = z.enum([
  "FAST_SHIPPING",
  "GREAT_PACKAGING",
  "ACCURATE_DESCRIPTION",
  "QUICK_COMMUNICATION",
  "FAIR_PRICING",
  "AS_DESCRIBED",
]);

const reviewerRoleEnum = z.enum(["BUYER", "SELLER"]);

export const createReviewSchema = z.object({
  orderId: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  comment: z
    .string()
    .min(10, "Review must be at least 10 characters")
    .max(1000)
    .trim(),
  tags: z.array(reviewTagEnum).max(6).default([]),
  reviewerRole: reviewerRoleEnum.default("BUYER"),
});
export type CreateReviewInput = z.infer<typeof createReviewSchema>;

export const sellerReplySchema = z.object({
  reviewId: z.string().min(1),
  reply: z.string().min(1).max(500).trim(),
});
export type SellerReplyInput = z.infer<typeof sellerReplySchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Watchlist schema
// ─────────────────────────────────────────────────────────────────────────────

export const toggleWatchSchema = z.object({
  listingId: z.string().min(1),
});
export type ToggleWatchInput = z.infer<typeof toggleWatchSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Order schemas
// ─────────────────────────────────────────────────────────────────────────────

const shippingAddressSchema = z
  .object({
    name: z.string().min(2, "Name is required").max(100),
    line1: z.string().min(5, "Street address is required").max(200),
    line2: z.string().max(200).optional(),
    city: z.string().min(2, "City is required").max(100),
    region: z.string().min(2, "Region is required").max(100),
    postcode: z.string().regex(/^\d{4}$/, "Invalid NZ postcode"),
  })
  .optional();

export const createOrderSchema = z.object({
  listingId: z.string().min(1, "Listing ID is required"),
  idempotencyKey: z.string().max(128).optional(),
  fulfillmentType: z
    .enum(["SHIPPED", "CASH_ON_PICKUP", "ONLINE_PAYMENT_PICKUP"])
    .optional(),
  shippingAddress: shippingAddressSchema,
});
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const confirmDeliverySchema = z.object({
  orderId: z.string().min(1, "Order ID is required"),
  itemAsDescribed: z.boolean(),
  issueType: z.string().optional(),
  deliveryPhotos: z.array(z.string()).max(4).optional(),
  notes: z.string().max(2000).optional(),
});
export type ConfirmDeliveryInput = z.infer<typeof confirmDeliverySchema>;

export const markDispatchedSchema = z.object({
  orderId: z.string().min(1, "Order ID is required"),
  trackingNumber: z.string().min(1, "Tracking number is required").max(100),
  courier: z.string().min(1, "Courier is required"),
  trackingUrl: z.string().max(500).optional(),
  estimatedDeliveryDate: z
    .string()
    .min(1, "Estimated delivery date is required")
    .refine(
      (val) => {
        const d = new Date(val);
        if (isNaN(d.getTime())) return false;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const diffDays = Math.round(
          (d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
        );
        return diffDays >= 1 && diffDays <= 14;
      },
      { message: "Estimated delivery must be 1-14 days from today." },
    ),
  dispatchPhotos: z
    .array(z.string().min(1))
    .min(1, "At least 1 dispatch photo is required.")
    .max(4, "Maximum 4 dispatch photos."),
});
export type MarkDispatchedInput = z.infer<typeof markDispatchedSchema>;

export const cancelOrderSchema = z.object({
  orderId: z.string().min(1, "Order ID is required"),
  reason: z.string().max(500).optional(),
});
export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Dispute schemas
// ─────────────────────────────────────────────────────────────────────────────

export const openDisputeSchema = z.object({
  orderId: z.string().min(1),
  reason: z.enum([
    "ITEM_NOT_RECEIVED",
    "ITEM_NOT_AS_DESCRIBED",
    "ITEM_DAMAGED",
    "WRONG_ITEM_SENT",
    "COUNTERFEIT_ITEM",
    "SELLER_UNRESPONSIVE",
    "SELLER_CANCELLED",
    "REFUND_NOT_PROCESSED",
    "OTHER",
  ]),
  description: z
    .string()
    .min(20, "Please describe the issue in at least 20 characters.")
    .max(2000)
    .trim(),
  evidenceUrls: z.array(z.string().min(1)).max(3).optional(),
});
export type OpenDisputeInput = z.infer<typeof openDisputeSchema>;

export const respondToDisputeSchema = z.object({
  orderId: z.string().min(1),
  response: z
    .string()
    .min(20, "Please describe your response in at least 20 characters.")
    .max(2000)
    .trim(),
});
export type RespondToDisputeInput = z.infer<typeof respondToDisputeSchema>;

export const submitCounterEvidenceSchema = z.object({
  orderId: z.string().min(1),
  description: z.string().min(10).max(2000).trim(),
  evidenceKeys: z.array(z.string()).max(4).optional(),
});
export type SubmitCounterEvidenceInput = z.infer<
  typeof submitCounterEvidenceSchema
>;

// ─────────────────────────────────────────────────────────────────────────────
// Admin schemas
// ─────────────────────────────────────────────────────────────────────────────

export const banUserSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
  reason: z
    .string()
    .min(10, "Ban reason must be at least 10 characters")
    .max(500),
});
export type BanUserInput = z.infer<typeof banUserSchema>;

export const resolveReportSchema = z.object({
  reportId: z.string().min(1, "Report ID is required"),
  action: z.enum(["dismiss", "remove", "ban"]),
});
export type ResolveReportInput = z.infer<typeof resolveReportSchema>;

export const resolveDisputeSchema = z.object({
  orderId: z.string().min(1, "Order ID is required"),
  favour: z.enum(["buyer", "seller"]),
});
export type ResolveDisputeInput = z.infer<typeof resolveDisputeSchema>;

export const partialRefundSchema = z.object({
  orderId: z.string().min(1),
  amountCents: z.number().positive(),
  reason: z.string().min(5).max(500),
});
export type PartialRefundInput = z.infer<typeof partialRefundSchema>;

export const overrideSchema = z.object({
  orderId: z.string().min(1),
  newDecision: z.enum(["refund", "dismiss", "partial_refund"]),
  reason: z.string().min(5).max(500),
  partialAmountCents: z.number().positive().optional(),
});
export type OverrideInput = z.infer<typeof overrideSchema>;

export const requestInfoSchema = z.object({
  orderId: z.string().min(1),
  target: z.enum(["buyer", "seller", "both"]),
  message: z.string().min(10).max(1000),
});
export type RequestInfoInput = z.infer<typeof requestInfoSchema>;

export const flagFraudSchema = z.object({
  userId: z.string().min(1),
  orderId: z.string().min(1),
  reason: z.string().min(10).max(500),
});
export type FlagFraudInput = z.infer<typeof flagFraudSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Interaction schemas
// ─────────────────────────────────────────────────────────────────────────────

export const requestCancellationSchema = z.object({
  orderId: z.string().min(1),
  reason: z
    .string()
    .min(10, "Please provide a reason (at least 10 characters).")
    .max(500)
    .trim(),
});
export type RequestCancellationInput = z.infer<
  typeof requestCancellationSchema
>;

export const respondToCancellationSchema = z.object({
  interactionId: z.string().min(1),
  action: z.enum(["ACCEPT", "REJECT"]),
  responseNote: z.string().max(500).trim().optional(),
});
export type RespondToCancellationInput = z.infer<
  typeof respondToCancellationSchema
>;

export const requestReturnSchema = z.object({
  orderId: z.string().min(1),
  reason: z.string().min(10).max(500).trim(),
  details: z
    .object({
      returnReason: z.enum([
        "damaged",
        "not_as_described",
        "wrong_item",
        "changed_mind",
      ]),
      preferredResolution: z.enum(["full_refund", "replacement", "exchange"]),
    })
    .optional(),
});
export type RequestReturnInput = z.infer<typeof requestReturnSchema>;

export const respondToReturnSchema = z.object({
  interactionId: z.string().min(1),
  action: z.enum(["ACCEPT", "REJECT"]),
  responseNote: z.string().max(1000).trim().optional(),
});
export type RespondToReturnInput = z.infer<typeof respondToReturnSchema>;

export const requestPartialRefundSchema = z.object({
  orderId: z.string().min(1),
  reason: z.string().min(10).max(500).trim(),
  amount: z.number().positive("Amount must be greater than 0"),
});
export type RequestPartialRefundInput = z.infer<
  typeof requestPartialRefundSchema
>;

export const respondToPartialRefundSchema = z.object({
  interactionId: z.string().min(1),
  action: z.enum(["ACCEPT", "REJECT", "COUNTER"]),
  responseNote: z.string().max(500).trim().optional(),
  counterAmount: z.number().positive().optional(),
});
export type RespondToPartialRefundInput = z.infer<
  typeof respondToPartialRefundSchema
>;

export const notifyShippingDelaySchema = z.object({
  orderId: z.string().min(1),
  reason: z.string().min(10).max(500).trim(),
  estimatedNewDate: z.string().optional(),
});
export type NotifyShippingDelayInput = z.infer<
  typeof notifyShippingDelaySchema
>;

export const respondToShippingDelaySchema = z.object({
  interactionId: z.string().min(1),
  action: z.enum(["ACCEPT", "REJECT"]),
  responseNote: z.string().max(500).trim().optional(),
});
export type RespondToShippingDelayInput = z.infer<
  typeof respondToShippingDelaySchema
>;

// ─────────────────────────────────────────────────────────────────────────────
// Cart schemas
// ─────────────────────────────────────────────────────────────────────────────

export const addToCartSchema = z.object({
  listingId: z.string().min(1, "Listing ID is required"),
});
export type AddToCartInput = z.infer<typeof addToCartSchema>;

export const removeFromCartSchema = z.object({
  listingId: z.string().min(1, "Listing ID is required"),
});
export type RemoveFromCartInput = z.infer<typeof removeFromCartSchema>;

export const checkoutCartSchema = z.object({
  idempotencyKey: z.string().max(128).optional(),
  shippingAddress: shippingAddressSchema,
  confirmedPriceVersion: z.boolean().optional(),
});
export type CheckoutCartInput = z.infer<typeof checkoutCartSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Report schema
// ─────────────────────────────────────────────────────────────────────────────

export const createReportSchema = z.object({
  targetUserId: z.string().min(1).optional(),
  listingId: z.string().min(1).optional(),
  reason: z.enum([
    "SCAM",
    "COUNTERFEIT",
    "PROHIBITED",
    "OFFENSIVE",
    "SPAM",
    "OTHER",
  ]),
  description: z
    .string()
    .min(10, "Please provide at least 10 characters describing the issue.")
    .max(2000, "Description must be 2000 characters or less.")
    .trim(),
});
export type CreateReportInput = z.infer<typeof createReportSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Watchlist price alert schema
// ─────────────────────────────────────────────────────────────────────────────

export const togglePriceAlertSchema = z.object({
  listingId: z.string().min(1),
  enabled: z.boolean(),
});
export type TogglePriceAlertInput = z.infer<typeof togglePriceAlertSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Account schemas
// ─────────────────────────────────────────────────────────────────────────────

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z
      .string()
      .min(12, "Password must be at least 12 characters")
      .max(128, "Password is too long")
      .regex(/[A-Z]/, "Must contain at least one uppercase letter")
      .regex(/[a-z]/, "Must contain at least one lowercase letter")
      .regex(/[0-9]/, "Must contain at least one number"),
    confirmPassword: z.string().min(1, "Please confirm your new password"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: "New password must be different from current password",
    path: ["newPassword"],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const updateProfileSchema = z.object({
  displayName: z
    .string()
    .min(2, "Display name must be at least 2 characters")
    .max(60),
  region: z.string().max(100).optional(),
  bio: z.string().max(500, "Bio must be under 500 characters").optional(),
});
export type UpdateProfileActionInput = z.infer<typeof updateProfileSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Onboarding schema
// ─────────────────────────────────────────────────────────────────────────────

export const completeOnboardingSchema = z.object({
  intent: z.enum(["BUY", "SELL", "BOTH"]),
  region: z.string().optional(),
});
export type CompleteOnboardingInput = z.infer<typeof completeOnboardingSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Seller schemas
// ─────────────────────────────────────────────────────────────────────────────

export const approveIdSchema = z.object({
  userId: z.string().cuid("Invalid user ID"),
});
export type ApproveIdInput = z.infer<typeof approveIdSchema>;

export const reviewVerificationSchema = z.object({
  sellerId: z.string().min(1),
  decision: z.enum(["APPROVED", "REJECTED"]),
  notes: z.string().max(500).optional(),
});
export type ReviewVerificationInput = z.infer<typeof reviewVerificationSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Problem resolver schema
// ─────────────────────────────────────────────────────────────────────────────

export const submitProblemSchema = z.object({
  orderId: z.string().min(1),
  problemType: z.enum([
    "CANCEL",
    "ITEM_DAMAGED",
    "NOT_AS_DESCRIBED",
    "WRONG_ITEM",
    "MISSING_PARTS",
    "NOT_RECEIVED",
    "CHANGED_MIND",
    "PARTIAL_REFUND",
    "SELLER_NOT_SHIPPING",
  ]),
  description: z.string().min(10).max(2000).trim(),
  evidenceKeys: z.array(z.string()).max(4).optional(),
  refundAmount: z.number().positive().optional(),
});
export type SubmitProblemInput = z.infer<typeof submitProblemSchema>;
export type ProblemType = SubmitProblemInput["problemType"];

// ─────────────────────────────────────────────────────────────────────────────
// Phone verification schemas
// ─────────────────────────────────────────────────────────────────────────────

export const requestPhoneSchema = z.object({
  phone: z.string().min(1, "Phone number is required"),
});
export type RequestPhoneInput = z.infer<typeof requestPhoneSchema>;

export const verifyPhoneCodeSchema = z.object({
  code: z
    .string()
    .length(6, "Code must be 6 digits")
    .regex(/^\d{6}$/, "Code must be 6 digits"),
});
export type VerifyPhoneCodeInput = z.infer<typeof verifyPhoneCodeSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// ID verification schemas
// ─────────────────────────────────────────────────────────────────────────────

export const requestVerificationUploadSchema = z.object({
  fileName: z.string().min(1).max(255),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  sizeBytes: z
    .number()
    .positive()
    .max(8 * 1024 * 1024, "File must be under 8MB"),
});
export type RequestVerificationUploadInput = z.infer<
  typeof requestVerificationUploadSchema
>;

export const submitIdVerificationSchema = z.object({
  documentType: z.enum([
    "DRIVERS_LICENSE",
    "PASSPORT",
    "NZ_FIREARMS_LICENCE",
    "OTHER_GOV_ID",
  ]),
  documentFrontKey: z.string().min(1, "Front of document is required"),
  documentBackKey: z.string().optional(),
  selfieKey: z.string().optional(),
});
export type SubmitIdVerificationInput = z.infer<
  typeof submitIdVerificationSchema
>;

export const rejectIdVerificationSchema = z.object({
  userId: z.string().min(1),
  reason: z.enum([
    "DOCUMENT_UNREADABLE",
    "NAME_MISMATCH",
    "DOCUMENT_EXPIRED",
    "SUSPECTED_FRAUD",
    "OTHER",
  ]),
  notes: z.string().max(500).optional(),
});
export type RejectIdVerificationInput = z.infer<
  typeof rejectIdVerificationSchema
>;

// ─────────────────────────────────────────────────────────────────────────────
// Business details (NZBN/GST) schemas
// ─────────────────────────────────────────────────────────────────────────────

export const updateBusinessDetailsSchema = z.object({
  isBusinessSeller: z.boolean(),
  nzbn: z
    .string()
    .regex(/^\d{13}$/, "NZBN must be a 13-digit number")
    .optional()
    .or(z.literal("")),
  isGstRegistered: z.boolean().default(false),
  gstNumber: z
    .string()
    .regex(/^\d{2}-\d{3}-\d{3}$/, "GST number must be in XX-XXX-XXX format")
    .optional()
    .or(z.literal("")),
});
export type UpdateBusinessDetailsInput = z.infer<
  typeof updateBusinessDetailsSchema
>;

// ─────────────────────────────────────────────────────────────────────────────
// MFA schemas
// ─────────────────────────────────────────────────────────────────────────────

export const verifyMfaCodeSchema = z.object({
  code: z
    .string()
    .length(6, "Code must be 6 digits")
    .regex(/^\d{6}$/, "Code must be 6 digits"),
});
export type VerifyMfaCodeInput = z.infer<typeof verifyMfaCodeSchema>;

export const verifyMfaBackupSchema = z.object({
  code: z.string().min(1, "Backup code is required").max(20),
});
export type VerifyMfaBackupInput = z.infer<typeof verifyMfaBackupSchema>;
