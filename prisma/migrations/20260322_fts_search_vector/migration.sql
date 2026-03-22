-- Sprint 4: Full-text search on Listing table
-- Adds tsvector column, trigger function, and GIN index

-- 1. Add searchVector column if not exists
ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "searchVector" tsvector;

-- 2. Create trigger function for auto-updating searchVector
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

-- 3. Drop existing trigger if any, then create
DROP TRIGGER IF EXISTS listing_search_vector_update ON "Listing";
CREATE TRIGGER listing_search_vector_update
  BEFORE INSERT OR UPDATE ON "Listing"
  FOR EACH ROW EXECUTE FUNCTION listing_search_vector_update();

-- 4. Create GIN index for fast full-text search
CREATE INDEX IF NOT EXISTS listing_search_idx ON "Listing" USING GIN ("searchVector");

-- 5. Backfill existing rows
UPDATE "Listing" SET
  "searchVector" =
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(suburb, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(region, '')), 'C')
WHERE "searchVector" IS NULL;
