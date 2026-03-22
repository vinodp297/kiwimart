// prisma/run-fts-migration.ts
// Run with: npx tsx prisma/run-fts-migration.ts
// Applies the full-text search migration to the Neon database.

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// Use DIRECT URL (not pooler) for DDL operations
const connString = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL!;
const adapter = new PrismaPg({ connectionString: connString });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Connecting to:', connString.replace(/:[^@]*@/, ':***@'));
  console.log('Applying full-text search migration...');

  // 1. Add searchVector column
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "searchVector" tsvector;
  `);
  console.log('  + searchVector column added');

  // 2. Create trigger function
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION listing_search_vector_update()
    RETURNS trigger AS $$
    BEGIN
      NEW."searchVector" :=
        setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(NEW.description, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(NEW.suburb, '')), 'C') ||
        setweight(to_tsvector('english', coalesce(NEW.region, '')), 'C');
      RETURN NEW;
    END
    $$ LANGUAGE plpgsql;
  `);
  console.log('  + Trigger function created');

  // 3. Create trigger
  await prisma.$executeRawUnsafe(`
    DROP TRIGGER IF EXISTS listing_search_vector_update ON "Listing";
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER listing_search_vector_update
      BEFORE INSERT OR UPDATE ON "Listing"
      FOR EACH ROW EXECUTE FUNCTION listing_search_vector_update();
  `);
  console.log('  + Trigger attached');

  // 4. Create GIN index
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS listing_search_idx ON "Listing" USING GIN ("searchVector");
  `);
  console.log('  + GIN index created');

  // 5. Backfill existing rows
  const result = await prisma.$executeRawUnsafe(`
    UPDATE "Listing" SET
      "searchVector" =
        setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(suburb, '')), 'C') ||
        setweight(to_tsvector('english', coalesce(region, '')), 'C')
    WHERE "searchVector" IS NULL;
  `);
  console.log(`  + Backfilled ${result} existing rows`);

  console.log('\nFull-text search migration complete!');
}

main()
  .catch((e) => {
    console.error('Migration failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
