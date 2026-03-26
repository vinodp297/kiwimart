// src/lib/image.ts
// ─── Centralised Image URL Builder ───────────────────────────────────────────
// Single source of truth for converting R2 keys → public image URLs.
// All pages / services must use this instead of constructing URLs inline.

const FALLBACK_IMAGE =
  'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=480&h=480&fit=crop';

/**
 * Build a publicly accessible URL for an R2 key.
 *
 * Rules:
 *  1. null / undefined  → fallback placeholder
 *  2. Already a full URL (starts with http)  → return as-is (seed data, legacy)
 *  3. Relative key      → prepend NEXT_PUBLIC_R2_PUBLIC_URL
 *  4. Env var missing   → warn once + return fallback
 */
export function getImageUrl(
  r2Key: string | null | undefined,
): string {
  if (!r2Key) return FALLBACK_IMAGE;

  // Already a full URL (Unsplash seed images, legacy absolute references)
  if (r2Key.startsWith('http')) return r2Key;

  const base =
    process.env.NEXT_PUBLIC_R2_PUBLIC_URL ??
    process.env.NEXT_PUBLIC_CDN_URL ??
    '';

  if (!base) {
    if (typeof window === 'undefined') {
      // Server-side — log once
      console.warn('[IMAGE] NEXT_PUBLIC_R2_PUBLIC_URL is not configured. Images will use placeholder.');
    }
    return FALLBACK_IMAGE;
  }

  // Remove trailing slash so we never double-slash
  return `${base.replace(/\/$/, '')}/${r2Key}`;
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
