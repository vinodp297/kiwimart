// src/worker.ts
// ─── Standalone Worker Entry Point ───────────────────────────────────────────
// Run this on Railway (or any long-lived process host) instead of Vercel.
// Starts all BullMQ workers and listens until SIGTERM/SIGINT.
//
// Usage: npx tsx src/worker.ts
// Railway: set startCommand to "npx tsx src/worker.ts"

import { logger } from '@/shared/logger'
import { startPayoutWorker } from '@/server/workers/payoutWorker'
import { startEmailWorker } from '@/server/workers/emailWorker'
import { startImageWorker } from '@/server/workers/imageWorker'

logger.info('worker.process.starting', {
  environment: process.env.NODE_ENV,
})

const payoutWorker = startPayoutWorker()
const emailWorker = startEmailWorker()
const imageWorker = startImageWorker()

logger.info('worker.process.ready', {
  queues: ['payout', 'email', 'image'],
})

async function shutdown(signal: string) {
  logger.info('worker.process.shutting_down', { signal })
  await Promise.all([
    payoutWorker.close(),
    emailWorker.close(),
    imageWorker.close(),
  ])
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
