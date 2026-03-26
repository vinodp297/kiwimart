#!/usr/bin/env tsx
// scripts/check-failed-jobs.ts
// ─── Dead Letter Queue Inspector ─────────────────────────────────────────────
// Lists the last 10 failed jobs in each BullMQ queue.
//
// Usage: npm run workers:check
//        (requires REDIS_URL in environment)

import { Queue } from 'bullmq'
import { getQueueConnection } from '@/infrastructure/queue/client'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const connection = getQueueConnection() as any
const queues = ['payout', 'email', 'image']

let totalFailed = 0

for (const queueName of queues) {
  const queue = new Queue(queueName, { connection })
  const failed = await queue.getFailed(0, 10)

  if (failed.length > 0) {
    totalFailed += failed.length
    console.log(`\n❌ Failed jobs in ${queueName} queue (${failed.length}):`)
    for (const job of failed) {
      console.log(`  Job ${job.id}: ${job.name}`)
      console.log(`  Error: ${job.failedReason}`)
      console.log(`  Attempts: ${job.attemptsMade}`)
      console.log(`  Data: ${JSON.stringify(job.data).slice(0, 120)}`)
    }
  } else {
    console.log(`✅ No failed jobs in ${queueName}`)
  }

  await queue.close()
}

if (totalFailed > 0) {
  console.log(`\n⚠️  Total failed jobs: ${totalFailed}`)
  process.exit(1)
} else {
  console.log('\n✅ All queues clean.')
}

connection.disconnect()
