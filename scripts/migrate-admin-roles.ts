#!/usr/bin/env tsx
// scripts/migrate-admin-roles.ts
// Sets adminRole=SUPER_ADMIN for all existing isAdmin=true users

import db from '@/lib/db'

void (async () => {
  const result = await db.user.updateMany({
    where: { isAdmin: true },
    data: { adminRole: 'SUPER_ADMIN' },
  })
  console.log('Updated admins:', result.count)

  const admins = await db.user.findMany({
    where: { isAdmin: true },
    select: { email: true, isAdmin: true, adminRole: true },
  })
  console.log('Current admins:', JSON.stringify(admins, null, 2))

  await db.$disconnect()
})()
