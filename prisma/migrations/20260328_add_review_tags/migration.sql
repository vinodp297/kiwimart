-- Review strength tags — buyer-selected chips stored per review
-- Replaces the keyword-inference approach with explicit user selection.

CREATE TYPE "ReviewTagType" AS ENUM (
  'FAST_SHIPPING',
  'GREAT_PACKAGING',
  'ACCURATE_DESCRIPTION',
  'QUICK_COMMUNICATION',
  'FAIR_PRICING',
  'AS_DESCRIBED'
);

CREATE TABLE "ReviewTag" (
  "id"       TEXT NOT NULL,
  "reviewId" TEXT NOT NULL,
  "tag"      "ReviewTagType" NOT NULL,

  CONSTRAINT "ReviewTag_pkey" PRIMARY KEY ("id")
);

-- Each review can have each tag at most once
CREATE UNIQUE INDEX "ReviewTag_reviewId_tag_key" ON "ReviewTag"("reviewId", "tag");

-- Fast lookup: "show me all reviews tagged FAST_SHIPPING for aggregation"
CREATE INDEX "ReviewTag_tag_idx" ON "ReviewTag"("tag");

-- FK → Review (cascade on delete so removing a review cleans up its tags)
ALTER TABLE "ReviewTag"
  ADD CONSTRAINT "ReviewTag_reviewId_fkey"
  FOREIGN KEY ("reviewId") REFERENCES "Review"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
