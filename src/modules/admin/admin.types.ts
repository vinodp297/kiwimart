// src/modules/admin/admin.types.ts
// ─── Admin Domain Types ──────────────────────────────────────────────────────

export interface AdminStats {
  totalUsers: number
  activeListings: number
  totalOrders: number
  pendingDisputes: number
  pendingReports: number
  totalRevenueNzd: number
}

export type ReportAction = 'dismiss' | 'remove' | 'ban'
export type DisputeFavour = 'buyer' | 'seller'
