// src/shared/auth/requirePermission.ts
// ─── Granular Permission Guards ───────────────────────────────────────────────
// Throws AppError — never returns an error union.
// Use in server actions and server components that throw.

import { auth } from '@/lib/auth'
import db from '@/lib/db'
import { AppError } from '@/shared/errors'
import { hasPermission, hasAnyPermission, type Permission } from '@/lib/permissions'
import { logger } from '@/shared/logger'
import type { AdminRole } from '@prisma/client'

export interface AdminUser {
  id: string
  email: string
  displayName: string
  isAdmin: boolean
  adminRole: AdminRole
}

// Require user to be any kind of admin (any role)
export async function requireAnyAdmin(): Promise<AdminUser> {
  const session = await auth()

  if (!session?.user?.id) {
    throw AppError.unauthenticated()
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      displayName: true,
      isAdmin: true,
      adminRole: true,
      isBanned: true,
    },
  })

  if (!user) {
    throw AppError.unauthenticated()
  }

  if (user.isBanned) {
    throw AppError.banned()
  }

  if (!user.isAdmin || !user.adminRole) {
    logger.warn('admin.access.denied', {
      userId: user.id,
      reason: 'not_admin',
    })
    throw AppError.notAdmin()
  }

  return user as AdminUser
}

// Require user to have a specific permission
export async function requirePermission(permission: Permission): Promise<AdminUser> {
  const admin = await requireAnyAdmin()

  if (!hasPermission(admin.adminRole, permission)) {
    logger.warn('admin.permission.denied', {
      userId: admin.id,
      adminRole: admin.adminRole,
      requiredPermission: permission,
    })
    throw new AppError(
      'UNAUTHORISED',
      `Your role (${admin.adminRole}) does not have permission: ${permission}`,
      403
    )
  }

  return admin
}

// Require user to have ANY of the given permissions
export async function requireAnyPermission(permissions: Permission[]): Promise<AdminUser> {
  const admin = await requireAnyAdmin()

  if (!hasAnyPermission(admin.adminRole, permissions)) {
    logger.warn('admin.permission.denied', {
      userId: admin.id,
      adminRole: admin.adminRole,
      requiredPermissions: permissions,
    })
    throw new AppError(
      'UNAUTHORISED',
      'Your role does not have any of the required permissions',
      403
    )
  }

  return admin
}

// Require SUPER_ADMIN specifically
export async function requireSuperAdmin(): Promise<AdminUser> {
  const admin = await requireAnyAdmin()

  if (admin.adminRole !== 'SUPER_ADMIN') {
    throw new AppError('UNAUTHORISED', 'Super Admin access required', 403)
  }

  return admin
}
