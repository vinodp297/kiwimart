// src/lib/seller-tiers.ts
// ─── Pure tier calculation functions — safe for client + server ──────────────

export type SellerTier = 'BRONZE' | 'SILVER' | 'GOLD' | null

export function calculateSellerTier(data: {
  completedSales: number
  avgRating: number
  completionRate: number
}): SellerTier {
  if (data.completedSales >= 50 && data.avgRating >= 4.5 && data.completionRate >= 95) return 'GOLD'
  if (data.completedSales >= 20 && data.avgRating >= 4.0 && data.completionRate >= 90) return 'SILVER'
  if (data.completedSales >= 5 && data.avgRating >= 3.5 && data.completionRate >= 80) return 'BRONZE'
  return null
}

export const TIER_REQUIREMENTS = {
  BRONZE: { sales: 5, rating: 3.5, completionRate: 80 },
  SILVER: { sales: 20, rating: 4.0, completionRate: 90 },
  GOLD:   { sales: 50, rating: 4.5, completionRate: 95 },
} as const

export const TIER_CONFIG: Record<string, { label: string; colour: string; icon: string }> = {
  GOLD:   { label: 'Gold Seller',   colour: 'text-amber-600 bg-amber-50 ring-amber-200', icon: '🥇' },
  SILVER: { label: 'Silver Seller', colour: 'text-gray-600 bg-gray-100 ring-gray-300', icon: '🥈' },
  BRONZE: { label: 'Bronze Seller', colour: 'text-orange-600 bg-orange-50 ring-orange-200', icon: '🥉' },
}
