// src/test/sessionStore.test.ts
// ─── Unit tests for session version tracking ────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock Redis client ─────────────────────────────────────────────────────────
const mockGet = vi.fn()
const mockIncr = vi.fn()
const mockExpire = vi.fn()
const mockGetRedisClient = vi.fn(() => ({
  get: mockGet,
  incr: mockIncr,
  expire: mockExpire,
}))

vi.mock('@/infrastructure/redis/client', () => ({
  getRedisClient: mockGetRedisClient,
}))

const { getSessionVersion, invalidateAllSessions } =
  await import('@/server/lib/sessionStore')

// ─────────────────────────────────────────────────────────────────────────────

describe('getSessionVersion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRedisClient.mockReturnValue({
      get: mockGet,
      incr: mockIncr,
      expire: mockExpire,
    })
  })

  it('returns parsed integer when Redis key exists', async () => {
    mockGet.mockResolvedValue('3')
    const v = await getSessionVersion('user-1')
    expect(v).toBe(3)
    expect(mockGet).toHaveBeenCalledWith('session:version:user-1')
  })

  it('returns 0 when Redis key is null (no prior sign-out)', async () => {
    mockGet.mockResolvedValue(null)
    const v = await getSessionVersion('user-new')
    expect(v).toBe(0)
  })

  it('returns 0 (fail-open) when Redis throws', async () => {
    mockGetRedisClient.mockImplementationOnce(() => {
      throw new Error('Redis unavailable')
    })
    const v = await getSessionVersion('user-redis-down')
    expect(v).toBe(0)
  })

  it('returns 0 (fail-open) when get() rejects', async () => {
    mockGet.mockRejectedValueOnce(new Error('timeout'))
    const v = await getSessionVersion('user-timeout')
    expect(v).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('invalidateAllSessions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRedisClient.mockReturnValue({
      get: mockGet,
      incr: mockIncr,
      expire: mockExpire,
    })
  })

  it('increments version and sets TTL', async () => {
    mockIncr.mockResolvedValue(4)
    mockExpire.mockResolvedValue(1)

    const v = await invalidateAllSessions('user-2')

    expect(v).toBe(4)
    expect(mockIncr).toHaveBeenCalledWith('session:version:user-2')
    expect(mockExpire).toHaveBeenCalledWith(
      'session:version:user-2',
      60 * 60 * 24 * 30 // 30 days
    )
  })

  it('returns 0 when Redis is unavailable', async () => {
    mockGetRedisClient.mockImplementationOnce(() => {
      throw new Error('Redis connection refused')
    })
    const v = await invalidateAllSessions('user-redis-down')
    expect(v).toBe(0)
    expect(mockIncr).not.toHaveBeenCalled()
  })

  it('returns 0 when incr() rejects', async () => {
    mockIncr.mockRejectedValueOnce(new Error('incr failed'))
    const v = await invalidateAllSessions('user-incr-fail')
    expect(v).toBe(0)
  })
})
