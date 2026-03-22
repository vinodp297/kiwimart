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

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Shared field validators
// ─────────────────────────────────────────────────────────────────────────────

const emailField = z
  .string()
  .min(1, 'Email is required')
  .email('Enter a valid email address')
  .max(254, 'Email is too long')
  .toLowerCase()
  .trim();

const passwordField = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(128, 'Password is too long')
  .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Must contain at least one number');

const usernameField = z
  .string()
  .min(3, 'Username must be at least 3 characters')
  .max(30, 'Username must be 30 characters or less')
  .regex(
    /^[a-zA-Z0-9_-]+$/,
    'Username can only contain letters, numbers, underscores and hyphens'
  )
  .trim();

const nzRegionField = z.enum([
  'Auckland',
  'Wellington',
  'Canterbury',
  'Waikato',
  'Bay of Plenty',
  'Otago',
  "Hawke's Bay",
  'Manawatū-Whanganui',
  'Northland',
  'Tasman',
  'Nelson',
  'Marlborough',
  'Southland',
  'Taranaki',
  'Gisborne',
  'West Coast',
] as const);

// ─────────────────────────────────────────────────────────────────────────────
// Auth schemas
// ─────────────────────────────────────────────────────────────────────────────

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, 'Password is required').max(128),
  turnstileToken: z.string().default(''),
  rememberMe: z.coerce.boolean().default(false),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const registerSchema = z
  .object({
    firstName: z
      .string()
      .min(1, 'First name is required')
      .max(50, 'First name is too long')
      .trim(),
    lastName: z
      .string()
      .min(1, 'Last name is required')
      .max(50, 'Last name is too long')
      .trim(),
    email: emailField,
    username: usernameField,
    password: passwordField,
    confirmPassword: z.string().min(1, 'Please confirm your password'),
    agreeTerms: z.literal(true, {
      errorMap: () => ({ message: 'You must accept the Terms of Service' }),
    }),
    agreeMarketing: z.boolean().default(false),
    turnstileToken: z.string().default(''),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
export type RegisterInput = z.infer<typeof registerSchema>;

export const forgotPasswordSchema = z.object({
  email: emailField,
  turnstileToken: z.string().default(''),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    token: z.string().min(1, 'Reset token is required'),
    password: passwordField,
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Listing schemas
// ─────────────────────────────────────────────────────────────────────────────

const conditionEnum = z.enum(['NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'PARTS']);
const shippingEnum = z.enum(['PICKUP', 'COURIER', 'BOTH']);

export const createListingSchema = z.object({
  title: z
    .string()
    .min(5, 'Title must be at least 5 characters')
    .max(100, 'Title must be 100 characters or less')
    .trim(),
  description: z
    .string()
    .min(20, 'Description must be at least 20 characters')
    .max(3000, 'Description must be 3000 characters or less')
    .trim(),
  categoryId: z.string().min(1, 'Category is required'),
  subcategoryName: z.string().max(50).optional(),
  condition: conditionEnum,
  // Price in NZD (dollars, not cents) — server converts to cents
  price: z
    .string()
    .transform(Number)
    .pipe(
      z
        .number()
        .positive('Price must be greater than $0')
        .max(100_000, 'Maximum price is $100,000')
        .multipleOf(0.01)
    ),
  offersEnabled: z.boolean().default(true),
  gstIncluded: z.boolean().default(false),
  shippingOption: shippingEnum,
  // Shipping price in NZD dollars (0 = free, null = not applicable)
  shippingPrice: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 0))
    .pipe(z.number().min(0).max(500).optional()),
  pickupAddress: z.string().max(200).optional(),
  region: nzRegionField,
  suburb: z
    .string()
    .min(1, 'Suburb is required')
    .max(100)
    .trim(),
  attributes: z
    .array(
      z.object({
        label: z.string().max(50).trim(),
        value: z.string().max(200).trim(),
      })
    )
    .max(20)
    .default([]),
  // Image R2 keys — validated for existence in the action
  imageKeys: z.array(z.string().max(200)).min(1, 'At least one photo is required').max(10),
});
export type CreateListingInput = z.infer<typeof createListingSchema>;

export const updateListingSchema = createListingSchema.partial().extend({
  listingId: z.string().min(1),
});
export type UpdateListingInput = z.infer<typeof updateListingSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Offer schema
// ─────────────────────────────────────────────────────────────────────────────

export const createOfferSchema = z.object({
  listingId: z.string().min(1),
  // Amount in NZD dollars — server validates against listing price
  amount: z
    .number()
    .positive('Offer amount must be greater than $0')
    .max(100_000),
  note: z.string().max(300).optional(),
});
export type CreateOfferInput = z.infer<typeof createOfferSchema>;

export const respondOfferSchema = z.object({
  offerId: z.string().min(1),
  action: z.enum(['ACCEPT', 'DECLINE']),
  declineNote: z.string().max(300).optional(),
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
    .min(1, 'Message cannot be empty')
    .max(1000, 'Message must be 1000 characters or less')
    .trim(),
});
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Review schema
// ─────────────────────────────────────────────────────────────────────────────

export const createReviewSchema = z.object({
  orderId: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  comment: z
    .string()
    .min(10, 'Review must be at least 10 characters')
    .max(1000)
    .trim(),
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

