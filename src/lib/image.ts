// src/lib/image.ts
// ─── Centralised Image URL Builder ───────────────────────────────────────────
// Single source of truth for converting R2 keys → public image URLs.
// All pages / services must use this instead of constructing URLs inline.

const FALLBACK_IMAGE =
  "https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=480&h=480&fit=crop";

/**
 * Build a publicly accessible URL for an R2 key.
 *
 * Rules:
 *  1. null / undefined  → fallback placeholder
 *  2. Already a full URL (starts with http)  → return as-is (seed data, legacy)
 *  3. Relative key      → prepend NEXT_PUBLIC_R2_PUBLIC_URL
 *  4. Env var missing   → warn once + return fallback
 */
export function getImageUrl(r2Key: string | null | undefined): string {
  if (!r2Key) return FALLBACK_IMAGE;

  // Already a full URL (Unsplash seed images, legacy absolute references)
  if (r2Key.startsWith("http")) return r2Key;

  const base =
    process.env.NEXT_PUBLIC_R2_PUBLIC_URL ??
    process.env.NEXT_PUBLIC_CDN_URL ??
    "";

  // The R2 S3 API endpoint (*.r2.cloudflarestorage.com) requires AWS4 auth
  // headers and is NOT publicly accessible. If set as the "public" URL,
  // browsers and next/image get 403/404 on every image request. Detect this
  // misconfiguration and fall through to the authenticated proxy route.
  const isPublicUrl = base && !base.includes("r2.cloudflarestorage.com");

  if (isPublicUrl) {
    // Public R2 URL or CDN configured — use direct URL
    return `${base.replace(/\/$/, "")}/${r2Key}`;
  }

  // Use the image proxy API route. The proxy fetches from R2 using the
  // authenticated S3 client and serves the image with proper cache headers
  // (1h browser, 24h CDN).
  return `/api/images/${r2Key}`;
}

// ─── Default / tier avatars ───────────────────────────────────────────────────
// Returns an SVG data-URI placeholder appropriate for a seller's tier.
// Used when avatarKey is null so we show something branded, not a broken image.

type SellerTierName = "basic" | "phone_verified" | "id_verified";

function makeSvgAvatar(bg: string, ring: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${bg}" rx="50"/><circle cx="50" cy="38" r="18" fill="${ring}" opacity="0.85"/><ellipse cx="50" cy="85" rx="30" ry="22" fill="${ring}" opacity="0.85"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const DEFAULT_AVATARS: Record<SellerTierName, string> = {
  basic: makeSvgAvatar("#D1CEC7", "#ffffff"),
  phone_verified: makeSvgAvatar("#3B82F6", "#ffffff"),
  id_verified: makeSvgAvatar("#D4A843", "#141414"),
};
const DEFAULT_AVATAR_BASIC = DEFAULT_AVATARS.basic;

/**
 * Return a branded SVG data-URI avatar for when the user has no photo.
 * Pass the seller's tier to use a tier-coloured placeholder.
 */
export function getDefaultAvatar(tier?: SellerTierName | null): string {
  return DEFAULT_AVATARS[tier ?? "basic"] ?? DEFAULT_AVATAR_BASIC;
}

/**
 * Prefer thumbnailKey (480×480 webp) for card/grid contexts;
 * fall back to full r2Key.
 */
export function getThumbUrl(
  img: { r2Key: string; thumbnailKey?: string | null } | undefined | null,
): string {
  if (!img) return FALLBACK_IMAGE;
  return getImageUrl(img.thumbnailKey ?? img.r2Key);
}
