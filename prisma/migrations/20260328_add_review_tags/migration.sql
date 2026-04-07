-- Review strength tags — buyer-selected chips stored per review
-- Replaces the keyword-inference approach with explicit user selection.
-- Idempotent: all statements use IF NOT EXISTS guards.

DO $$BEGIN
  CREATE TYPE "ReviewTagType" AS ENUM (
    'FAST_SHIPPING',
    'GREAT_PACKAGING',
    'ACCURATE_DESCRIPTION',
    'QUICK_COMMUNICATION',
    'FAIR_PRICING',
    'AS_DESCRIBED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END$$;

CREATE TABLE IF NOT EXISTS "ReviewTag" (
  "id"       TEXT NOT NULL,
  "reviewId" TEXT NOT NULL,
  "tag"      "ReviewTagType" NOT NULL,

  CONSTRAINT "ReviewTag_pkey" PRIMARY KEY ("id")
);

-- Each review can have each tag at most once
CREATE UNIQUE INDEX IF NOT EXISTS "ReviewTag_reviewId_tag_key" ON "ReviewTag"("reviewId", "tag");

-- Fast lookup: "show me all reviews tagged FAST_SHIPPING for aggregation"
CREATE INDEX IF NOT EXISTS "ReviewTag_tag_idx" ON "ReviewTag"("tag");

-- FK → Review (cascade on delete so removing a review cleans up its tags)
DO $$BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReviewTag_reviewId_fkey') THEN
    ALTER TABLE "ReviewTag"
      ADD CONSTRAINT "ReviewTag_reviewId_fkey"
      FOREIGN KEY ("reviewId") REFERENCES "Review"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;
