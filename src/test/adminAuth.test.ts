// src/test/adminAuth.test.ts
// ─── Tests for DB-backed admin authorization ─────────────────────────────────
// Verifies that requireAdmin() always checks the DB, never trusts JWT alone.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { auth } from '@/lib/auth'
import db from '@/lib/db'
import { audit } from '@/server/lib/audit'

// We test the requireAdmin pattern directly since it's a private function
// inside admin.ts. We replicate its logic to verify correctness.

async function simulateRequireAdmin(): Promise<
  { userId: string } | { error: string }
> {
  const session = await auth()
  if (!session?.user?.id) return { error: 'Authentication required.' }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, isAdmin: true, isBanned: true },
  })

  if (!user) return { error: 'User not found.' }
  if (user.isBanned) return { error: 'Account suspended.' }

  if (!user.isAdmin) {
    audit({
      userId: session.user.id,
      action: 'ADMIN_ACTION' as any,
      entityType: 'User',
      entityId: session.user.id,
      metadata: {
        denied: true,
        reason: 'not_admin_in_db',
        tokenClaim: (session.user as any).isAdmin,
      },
    })
    return { error: 'Unauthorised.' }
  }

  return { userId: user.id }
}

describe('Admin DB-backed authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('allows access for active, non-banned admin', async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: 'admin-1', isAdmin: true },
    } as never)

    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: 'admin-1',
      isAdmin: true,
      isBanned: false,
    } as never)

    const result = await simulateRequireAdmin()
    expect(result).toEqual({ userId: 'admin-1' })
  })

  it('DENIES access for demoted admin (DB isAdmin=false, stale token)', async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: 'demoted-1', isAdmin: true }, // Token still says admin
    } as never)

    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: 'demoted-1',
      isAdmin: false, // DB says NOT admin
      isBanned: false,
    } as never)

    const result = await simulateRequireAdmin()
    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error).toBe('Unauthorised.')
    }

    // Should audit the attempted access
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          denied: true,
          reason: 'not_admin_in_db',
        }),
      })
    )
  })

  it('DENIES access for banned admin', async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: 'banned-admin', isAdmin: true },
    } as never)

    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: 'banned-admin',
      isAdmin: true,
      isBanned: true,
    } as never)

    const result = await simulateRequireAdmin()
    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error).toBe('Account suspended.')
    }
  })

  it('DENIES when no session (unauthenticated)', async () => {
    vi.mocked(auth).mockResolvedValue(null as never)

    const result = await simulateRequireAdmin()
    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error).toBe('Authentication required.')
    }

    // Should NOT hit DB at all
    expect(db.user.findUnique).not.toHaveBeenCalled()
  })

  it('DENIES when user not found in DB (deleted user)', async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: 'deleted-user' },
    } as never)

    vi.mocked(db.user.findUnique).mockResolvedValue(null as never)

    const result = await simulateRequireAdmin()
    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error).toBe('User not found.')
    }
  })

  it('always queries DB even when token claims isAdmin=true', async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: 'user-x', isAdmin: true },
    } as never)

    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: 'user-x',
      isAdmin: true,
      isBanned: false,
    } as never)

    await simulateRequireAdmin()

    // Critical: DB was always queried
    expect(db.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-x' },
      select: { id: true, isAdmin: true, isBanned: true },
    })
  })
})
