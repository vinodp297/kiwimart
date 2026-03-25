// ─── KiwiMart — Complete Type Definitions (Sprint 1 + Sprint 2) ──────────────
// These types mirror the Prisma schema that will be generated in Sprint 3.
// Every field name, casing and nullability matches what the ORM will produce,
// so wiring real data in Sprint 3 requires only swapping the data source.

// ─────────────────────────────── Primitives ──────────────────────────────────

export type Condition = 'new' | 'like-new' | 'good' | 'fair' | 'parts';

export type NZRegion =
  | 'Auckland'
  | 'Wellington'
  | 'Canterbury'
  | 'Waikato'
  | 'Bay of Plenty'
  | 'Otago'
  | "Hawke's Bay"
  | 'Manawatū-Whanganui'
  | 'Northland'
  | 'Tasman'
  | 'Nelson'
  | 'Marlborough'
  | 'Southland'
  | 'Taranaki'
  | 'Gisborne'
  | 'West Coast';

export type SortOption =
  | 'newest'
  | 'oldest'
  | 'price-asc'
  | 'price-desc'
  | 'most-watched';

export type ListingStatus =
  | 'active'
  | 'sold'
  | 'reserved'
  | 'expired'
  | 'draft'
  | 'removed';

export type ShippingOption = 'pickup' | 'courier' | 'both';

export type OfferStatus = 'pending' | 'accepted' | 'declined' | 'expired' | 'withdrawn';

export type OrderStatus =
  | 'awaiting_payment'
  | 'payment_held'
  | 'dispatched'
  | 'delivered'
  | 'completed'
  | 'disputed'
  | 'refunded'
  | 'cancelled';

export type DisputeReason =
  | 'item_not_received'
  | 'item_not_as_described'
  | 'item_damaged'
  | 'seller_unresponsive'
  | 'other';

// ─────────────────────────────── Core Models ─────────────────────────────────

/** Compact card shape — used in grids / search results */
export interface ListingCard {
  id: string;
  title: string;
  price: number;
  condition: Condition;
  categoryName: string;
  subcategoryName: string;
  region: NZRegion;
  suburb: string;
  thumbnailUrl: string;
  sellerName: string;
  sellerUsername: string;
  sellerRating: number;       // 1–5
  sellerVerified: boolean;
  viewCount: number;
  watcherCount: number;
  createdAt: string;          // ISO 8601
  status: ListingStatus;
  shippingOption: ShippingOption;
  shippingPrice: number | null; // null = free / pickup only
  offersEnabled: boolean;
  // Quick-filter flags (default false when absent)
  isUrgent?: boolean;
  isNegotiable?: boolean;
  shipsNationwide?: boolean;
  // Price-drop tracking (null/absent = no drop recorded)
  previousPrice?: number | null;
  priceDroppedAt?: string | null;
}

/** Full detail shape — used on listing detail page */
export interface ListingDetail extends ListingCard {
  description: string;
  images: ListingImage[];
  attributes: ListingAttribute[];
  seller: SellerPublic;
  relatedListings: ListingCard[];
  offerCount: number;
  gstIncluded: boolean;
  pickupAddress: string | null;
}

export interface ListingImage {
  id: string;
  url: string;
  altText: string;
  order: number;
}

export interface ListingAttribute {
  label: string;
  value: string;
}

// ─────────────────────────────── Seller / User ───────────────────────────────

/** Public-facing seller profile */
export interface SellerPublic {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  region: NZRegion;
  suburb: string;
  rating: number;
  reviewCount: number;
  verified: boolean;
  /** ISO date — used for "Member since" */
  memberSince: string;
  activeListingCount: number;
  soldCount: number;
  responseTimeLabel: string;  // e.g. "Usually replies within 1 hour"
  badges: SellerBadge[];
}

export type SellerBadge =
  | 'top_seller'
  | 'fast_responder'
  | 'verified_id'
  | 'trusted_seller'
  | 'nz_business';

/** Authenticated session user (subset of DB User row) */
export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  email: string;
  avatarUrl: string | null;
  verified: boolean;
  sellerEnabled: boolean;
}

// ─────────────────────────────── Auth Forms ──────────────────────────────────

export interface LoginFormValues {
  email: string;
  password: string;
  rememberMe: boolean;
}

export interface RegisterFormValues {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  confirmPassword: string;
  agreeTerms: boolean;
  agreeMarketing: boolean;
}

export interface ForgotPasswordFormValues {
  email: string;
}

// ─────────────────────────────── Sell / Create Listing ───────────────────────

export interface CreateListingFormValues {
  // Step 1 — Photos
  images: File[];
  // Step 2 — Details
  title: string;
  description: string;
  categoryId: string;
  subcategoryName: string;
  condition: Condition;
  attributes: ListingAttribute[];
  // Step 3 — Pricing
  price: string;
  offersEnabled: boolean;
  gstIncluded: boolean;
  // Step 4 — Shipping
  shippingOption: ShippingOption;
  shippingPrice: string;
  pickupAddress: string;
  region: NZRegion | '';
  suburb: string;
}

// ─────────────────────────────── Dashboard ───────────────────────────────────

export interface BuyerOrder {
  id: string;
  listingId: string;
  listingTitle: string;
  listingThumbnail: string;
  sellerName: string;
  sellerUsername: string;
  price: number;
  shippingPrice: number;
  total: number;
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
  trackingNumber: string | null;
  trackingUrl: string | null;
  canConfirmDelivery: boolean;
  canDispute: boolean;
}

export interface WatchlistItem {
  id: string;             // listing id
  title: string;
  price: number;
  condition: Condition;
  thumbnailUrl: string;
  sellerName: string;
  region: NZRegion;
  suburb: string;
  watchedAt: string;
  status: ListingStatus;
}

export interface MessageThread {
  id: string;
  otherPartyName: string;
  otherPartyUsername: string;
  otherPartyAvatar: string | null;
  listingId: string;
  listingTitle: string;
  listingThumbnail: string;
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
  messages: Message[];
}

export interface Message {
  id: string;
  body: string;
  senderId: string;             // 'me' or other user id
  senderName: string;
  createdAt: string;
  read: boolean;
}

export interface SellerListing extends ListingCard {
  offerCount: number;
  expiresAt: string | null;
}

export interface SellerPayout {
  id: string;
  amount: number;
  status: 'pending' | 'paid' | 'failed';
  orderId: string;
  listingTitle: string;
  paidAt: string | null;
  estimatedArrival: string | null;
}

export interface SellerStats {
  totalSales: number;
  totalRevenue: number;
  activeListings: number;
  pendingOrders: number;
  avgRating: number;
  reviewCount: number;
  pendingPayout: number;
  responseRate: number;       // 0–100
}

// ─────────────────────────────── Reviews ─────────────────────────────────────

export interface Review {
  id: string;
  buyerName: string;
  buyerUsername: string;
  buyerAvatarUrl: string | null;
  rating: number;
  comment: string;
  listingTitle: string;
  createdAt: string;
  sellerReply: string | null;
}

// ─────────────────────────────── Filters (Search page) ──────────────────────

export interface SearchFilters {
  query: string;
  category: string;
  subcategory: string;
  condition: Condition | '';
  region: NZRegion | '';
  priceMin: string;
  priceMax: string;
  sort: SortOption;
  // Quick filter chips
  isUrgent: boolean;
  isNegotiable: boolean;
  shipsNationwide: boolean;
  verifiedOnly: boolean;
}

// ─────────────────────────────── Shared UI ───────────────────────────────────

export interface Category {
  id: string;
  name: string;
  icon: string;
  subcategories: string[];
  listingCount: number;
}

export interface TrustBadge {
  icon: string;
  title: string;
  description: string;
}

export interface SiteStat {
  value: string;
  label: string;
}

// ─────────────────────────────── API Response helpers ────────────────────────
// These will wrap server action returns in Sprint 3.

export type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

