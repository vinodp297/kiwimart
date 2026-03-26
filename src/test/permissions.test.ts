// src/test/permissions.test.ts
// ─── Permission Matrix Tests ──────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import {
  hasPermission,
  hasAllPermissions,
  hasAnyPermission,
  ROLE_PERMISSIONS,
  getRoleDisplayName,
  getRoleBadgeColor,
  type Permission,
} from '@/lib/permissions'
import type { AdminRole } from '@prisma/client'

const ALL_ROLES: AdminRole[] = [
  'SUPER_ADMIN',
  'FINANCE_ADMIN',
  'DISPUTES_ADMIN',
  'TRUST_SAFETY_ADMIN',
  'SUPPORT_ADMIN',
  'SELLER_MANAGER',
  'READ_ONLY_ADMIN',
]

describe('Permission System', () => {
  it('SUPER_ADMIN has all permissions', () => {
    const allPermissions = ALL_ROLES.flatMap(
      (role) => ROLE_PERMISSIONS[role]
    )
    const uniquePermissions = [...new Set(allPermissions)]
    uniquePermissions.forEach((p) => {
      expect(hasPermission('SUPER_ADMIN', p as Permission)).toBe(true)
    })
  })

  it('FINANCE_ADMIN cannot resolve disputes', () => {
    expect(hasPermission('FINANCE_ADMIN', 'RESOLVE_DISPUTES')).toBe(false)
  })

  it('DISPUTES_ADMIN cannot view revenue', () => {
    expect(hasPermission('DISPUTES_ADMIN', 'VIEW_REVENUE')).toBe(false)
  })

  it('TRUST_SAFETY_ADMIN can ban users', () => {
    expect(hasPermission('TRUST_SAFETY_ADMIN', 'BAN_USERS')).toBe(true)
  })

  it('READ_ONLY_ADMIN cannot ban users', () => {
    expect(hasPermission('READ_ONLY_ADMIN', 'BAN_USERS')).toBe(false)
  })

  it('SUPPORT_ADMIN cannot process refunds', () => {
    expect(hasPermission('SUPPORT_ADMIN', 'PROCESS_REFUNDS')).toBe(false)
  })

  it('SELLER_MANAGER can approve sellers', () => {
    expect(hasPermission('SELLER_MANAGER', 'APPROVE_SELLERS')).toBe(true)
  })

  it('null role has no permissions', () => {
    expect(hasPermission(null, 'VIEW_REVENUE')).toBe(false)
    expect(hasPermission(undefined, 'BAN_USERS')).toBe(false)
  })

  it('FINANCE_ADMIN cannot ban users', () => {
    expect(hasPermission('FINANCE_ADMIN', 'BAN_USERS')).toBe(false)
  })

  it('DISPUTES_ADMIN can resolve disputes', () => {
    expect(hasPermission('DISPUTES_ADMIN', 'RESOLVE_DISPUTES')).toBe(true)
  })

  it('DISPUTES_ADMIN cannot manage admin roles', () => {
    expect(hasPermission('DISPUTES_ADMIN', 'MANAGE_ADMIN_ROLES')).toBe(false)
  })

  it('READ_ONLY_ADMIN cannot moderate content', () => {
    expect(hasPermission('READ_ONLY_ADMIN', 'MODERATE_CONTENT')).toBe(false)
  })

  it('SELLER_MANAGER cannot resolve disputes', () => {
    expect(hasPermission('SELLER_MANAGER', 'RESOLVE_DISPUTES')).toBe(false)
  })

  it('only SUPER_ADMIN can manage admin roles', () => {
    const nonSuper: AdminRole[] = ALL_ROLES.filter((r) => r !== 'SUPER_ADMIN')
    nonSuper.forEach((role) => {
      expect(hasPermission(role, 'MANAGE_ADMIN_ROLES')).toBe(false)
    })
    expect(hasPermission('SUPER_ADMIN', 'MANAGE_ADMIN_ROLES')).toBe(true)
  })

  it('hasAllPermissions returns true only when all match', () => {
    expect(
      hasAllPermissions('SUPER_ADMIN', ['VIEW_REVENUE', 'BAN_USERS', 'RESOLVE_DISPUTES'])
    ).toBe(true)
    expect(
      hasAllPermissions('FINANCE_ADMIN', ['VIEW_REVENUE', 'BAN_USERS'])
    ).toBe(false)
  })

  it('hasAnyPermission returns true when at least one matches', () => {
    expect(
      hasAnyPermission('FINANCE_ADMIN', ['VIEW_REVENUE', 'BAN_USERS'])
    ).toBe(true)
    expect(
      hasAnyPermission('READ_ONLY_ADMIN', ['BAN_USERS', 'RESOLVE_DISPUTES'])
    ).toBe(false)
  })

  it('every role has a display name', () => {
    ALL_ROLES.forEach((role) => {
      const name = getRoleDisplayName(role)
      expect(name).toBeTruthy()
      expect(typeof name).toBe('string')
    })
  })

  it('every role has a badge color', () => {
    ALL_ROLES.forEach((role) => {
      const color = getRoleBadgeColor(role)
      expect(color).toMatch(/^#/)
    })
  })

  it('ROLE_PERMISSIONS covers all 7 roles', () => {
    expect(Object.keys(ROLE_PERMISSIONS)).toHaveLength(7)
  })
})
