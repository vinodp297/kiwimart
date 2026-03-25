// src/infrastructure/queue/client.ts
// ─── IORedis Connection for BullMQ ───────────────────────────────────────────
// Single ioredis connection used by all BullMQ queues and workers.
// (This is separate from @upstash/redis — BullMQ requires native TCP Redis)

import IORedis from 'ioredis'

let _connection: IORedis | null = null

export function getQueueConnection(): IORedis {
  if (_connection) return _connection

  const redisUrl = process.env.REDIS_URL

  if (
    !redisUrl ||
    redisUrl.includes('PLACEHOLDER') ||
    redisUrl.includes('placeholder')
  ) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'REDIS_URL is required in production. ' +
        'Configure a real Upstash Redis URL.'
      )
    }
    // Development fallback — local Redis
    _connection = new IORedis({
      host: 'localhost',
      port: 6379,
      maxRetriesPerRequest: null,
      lazyConnect: true,
    })
    return _connection
  }

  _connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    tls: redisUrl.startsWith('rediss://') ? {} : undefined,
    retryStrategy: (times: number) => {
      if (times > 3) return null
      return Math.min(times * 200, 2000)
    },
  })

  _connection.on('error', (err) => {
    console.error('[Queue] Redis connection error:', err.message)
  })

  return _connection
}
