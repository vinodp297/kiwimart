-- Recently Viewed Listings — persistent tracking for authenticated users.
-- Guests still fall back to localStorage.
-- Idempotent: all statements use IF NOT EXISTS guards.

CREATE TABLE IF NOT EXISTS "RecentlyViewed" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "listingId" TEXT NOT NULL,
  "viewedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RecentlyViewed_pkey" PRIMARY KEY ("id")
);

-- One row per (user, listing) — upsert updates viewedAt on revisit
CREATE UNIQUE INDEX IF NOT EXISTS "RecentlyViewed_userId_listingId_key"
  ON "RecentlyViewed"("userId", "listingId");

-- Fast fetch: user's recently viewed sorted by recency
CREATE INDEX IF NOT EXISTS "RecentlyViewed_userId_viewedAt_idx"
  ON "RecentlyViewed"("userId", "viewedAt" DESC);

DO $$BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RecentlyViewed_userId_fkey') THEN
    ALTER TABLE "RecentlyViewed"
      ADD CONSTRAINT "RecentlyViewed_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

DO $$BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RecentlyViewed_listingId_fkey') THEN
    ALTER TABLE "RecentlyViewed"
      ADD CONSTRAINT "RecentlyViewed_listingId_fkey"
      FOREIGN KEY ("listingId") REFERENCES "Listing"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;
