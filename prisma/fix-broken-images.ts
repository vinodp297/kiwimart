// prisma/fix-broken-images.ts
// ─── Fix broken Unsplash image URLs ──────────────────────────────────────────
// Run: npx tsx prisma/fix-broken-images.ts
//
// Replaces 3 specific Unsplash photo IDs that return 404 with working
// alternatives from the same category.

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

// Map of broken photo ID fragment → working replacement photo ID
const REPLACEMENTS: Record<string, string> = {
  // Electronics fallback (iPad Air M1, JBL Flip 6, Anker Charger)
  'photo-1546868871-af0de0ae72be': 'photo-1588872657578-7efd1f1555ed',
  // Canon EOS R6 Mark II
  'photo-1606986628253-3b22b0e03820': 'photo-1527977966376-1c8408f9f108',
  // Weber Q2200 BBQ
  'photo-1571187271558-6b7e12e851b7': 'photo-1556909114-f6e7ad7d3136',
};

async function main() {
  console.log('🔧 Fixing broken Unsplash image URLs...\n');

  let totalFixed = 0;

  for (const [brokenId, workingId] of Object.entries(REPLACEMENTS)) {
    const brokenUrl = `https://images.unsplash.com/${brokenId}?w=800&h=600&fit=crop`;
    const workingUrl = `https://images.unsplash.com/${workingId}?w=800&h=600&fit=crop`;

    const result = await prisma.$executeRaw`
      UPDATE "ListingImage"
      SET "r2Key" = ${workingUrl}
      WHERE "r2Key" = ${brokenUrl}
    `;

    console.log(`  ${brokenId}`);
    console.log(`  → ${workingId}`);
    console.log(`  Updated ${result} record(s)\n`);
    totalFixed += result;
  }

  console.log(`✅ Done — fixed ${totalFixed} image record(s)`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
