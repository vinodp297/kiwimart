// scripts/clear-rate-limits.ts
// Clears all rate limit keys from Upstash Redis.
// Run: npx tsx scripts/clear-rate-limits.ts

import { loadEnvConfig } from '@next/env'
loadEnvConfig(process.cwd())

import { Redis } from '@upstash/redis'

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
})

async function main() {
  const keys = await redis.keys('km:rl:*')
  console.log(`Found ${keys.length} rate limit keys:`)
  if (keys.length > 0) {
    console.log(keys)
    await redis.del(...keys)
    console.log('Cleared all rate limit keys')
  }

  // Also clear any registration keys
  const regKeys = await redis.keys('*register*')
  console.log(`Found ${regKeys.length} register keys`)
  if (regKeys.length > 0) {
    console.log(regKeys)
    await redis.del(...regKeys)
    console.log('Cleared register keys')
  }

  // Show all remaining keys for reference
  const remaining = await redis.keys('km:*')
  console.log(`Remaining km: keys: ${remaining.length}`)
  if (remaining.length > 0) {
    console.log(remaining)
  }
}

main().catch(console.error)
