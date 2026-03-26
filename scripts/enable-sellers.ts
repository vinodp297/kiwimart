#!/usr/bin/env tsx
// scripts/enable-sellers.ts — one-time migration: enable seller for all eligible users
import db from '@/lib/db'

void (async () => {
  const result = await db.user.updateMany({
    where: { isBanned: false, isAdmin: false, sellerEnabled: false },
    data: { sellerEnabled: true },
  })
  console.log('Users updated:', result.count)
  await db.$disconnect()
})()
