// src/test/requireUser.test.ts
// ─── Tests for requireUser() banned user enforcement ─────────────────────────
// Verifies that banned users are always blocked regardless of session state.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { requireUser } from '@/server/lib/requireUser'
import { auth } from '@/lib/auth'
import db from '@/lib/db'

describe('requireUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns user data for valid, active, non-banned user', async () => {
    vi.mocked(auth).mockResolvedValue({
      user: {
        id: 'user-123',
        email: 'active@test.com',
      },
    } as never)

    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: 'user-123',
      email: 'active@test.com',
      isAdmin: false,
      isBanned: false,
      sellerEnabled: true,
      stripeOnboarded: true,
    } as never)

    const user = await requireUser()
    expect(user).toEqual({
      id: 'user-123',
      email: 'active@test.com',
      isAdmin: false,
      sellerEnabled: true,
      stripeOnboarded: true,
    })
  })

  it('throws for unauthenticated request (no session)', async () => {
    vi.mocked(auth).mockResolvedValue(null as never)

    await expect(requireUser()).rejects.toThrow('Unauthorised — please sign in')
    expect(db.user.findUnique).not.toHaveBeenCalled()
  })

  it('throws for session with no user ID', async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: undefined },
    } as never)

    await expect(requireUser()).rejects.toThrow('Unauthorised — please sign in')
  })

  it('throws for banned user and cleans up their sessions', async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: 'banned-user-1' },
    } as never)

    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: 'banned-user-1',
      email: 'banned@test.com',
      isAdmin: false,
      isBanned: true,
      sellerEnabled: false,
      stripeOnboarded: false,
    } as never)

    vi.mocked(db.session.deleteMany).mockResolvedValue({ count: 2 } as never)

    await expect(requireUser()).rejects.toThrow(
      'Your account has been suspended'
    )

    // Should delete all sessions as cleanup
    expect(db.session.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'banned-user-1' },
    })
  })

  it('throws when user not found in DB (deleted account)', async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: 'ghost-user' },
    } as never)

    vi.mocked(db.user.findUnique).mockResolvedValue(null as never)

    await expect(requireUser()).rejects.toThrow('Unauthorised — user not found')
  })

  it('returns admin flag correctly', async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: 'admin-user' },
    } as never)

    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: 'admin-user',
      email: 'admin@test.com',
      isAdmin: true,
      isBanned: false,
      sellerEnabled: true,
      stripeOnboarded: true,
    } as never)

    const user = await requireUser()
    expect(user.isAdmin).toBe(true)
  })

  it('always performs fresh DB lookup (never trusts session alone)', async () => {
    vi.mocked(auth).mockResolvedValue({
      user: {
        id: 'user-456',
        email: 'test@test.com',
        isBanned: false, // Session says not banned
      },
    } as never)

    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: 'user-456',
      email: 'test@test.com',
      isAdmin: false,
      isBanned: false,
      sellerEnabled: false,
      stripeOnboarded: false,
    } as never)

    await requireUser()

    // Critical: DB was always queried even though session had data
    expect(db.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-456' },
      select: {
        id: true,
        email: true,
        isAdmin: true,
        isBanned: true,
        sellerEnabled: true,
        stripeOnboarded: true,
      },
    })
  })
})
