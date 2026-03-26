// src/shared/auth/index.ts
// ─── Shared Auth Guards ───────────────────────────────────────────────────────
// Re-exports auth guard helpers from a single shared location.
// Import from here in new service-layer code.

export { requireUser } from '@/server/lib/requireUser'
export { requireAdmin } from '@/server/lib/requireAdmin'
export {
  requireAnyAdmin,
  requirePermission,
  requireAnyPermission,
  requireSuperAdmin,
} from '@/shared/auth/requirePermission'
