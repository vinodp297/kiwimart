-- Sprint 4: Full-text search on Listing table
-- Adds tsvector column, trigger function, and GIN index.
--
-- Option B safety wrap: the trigger function is created unconditionally (it is
-- table-independent), but all Listing-dependent DDL is guarded inside a DO block
-- that returns early when the Listing table does not yet exist.  This allows
-- `prisma migrate reset --force` to run the full migration sequence without
-- error even when this migration precedes the initial schema creation.

-- 1. Trigger function (table-independent — always safe to create/replace)
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

-- 2. All Listing-dependent operations: guarded by table existence check
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'Listing'
  ) THEN
    RAISE NOTICE 'FTS migration: Listing table not found — skipping column, trigger, index and backfill';
    RETURN;
  END IF;

  -- Add searchVector column if not already present
  EXECUTE 'ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "searchVector" tsvector';

  -- Drop + recreate trigger so this migration is idempotent
  EXECUTE 'DROP TRIGGER IF EXISTS listing_search_vector_update ON "Listing"';
  EXECUTE $cmd$
    CREATE TRIGGER listing_search_vector_update
      BEFORE INSERT OR UPDATE ON "Listing"
      FOR EACH ROW EXECUTE FUNCTION listing_search_vector_update()
  $cmd$;

  -- GIN index for fast full-text search
  EXECUTE 'CREATE INDEX IF NOT EXISTS listing_search_idx ON "Listing" USING GIN ("searchVector")';

  -- Backfill existing rows
  UPDATE "Listing" SET
    "searchVector" =
      setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
      setweight(to_tsvector('english', coalesce(suburb, '')), 'C') ||
      setweight(to_tsvector('english', coalesce(region, '')), 'C')
  WHERE "searchVector" IS NULL;
END $$;
