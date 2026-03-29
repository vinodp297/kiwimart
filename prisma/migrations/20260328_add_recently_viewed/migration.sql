-- Recently Viewed Listings — persistent tracking for authenticated users.
-- Guests still fall back to localStorage.

CREATE TABLE "RecentlyViewed" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "listingId" TEXT NOT NULL,
  "viewedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RecentlyViewed_pkey" PRIMARY KEY ("id")
);

-- One row per (user, listing) — upsert updates viewedAt on revisit
CREATE UNIQUE INDEX "RecentlyViewed_userId_listingId_key"
  ON "RecentlyViewed"("userId", "listingId");

-- Fast fetch: user's recently viewed sorted by recency
CREATE INDEX "RecentlyViewed_userId_viewedAt_idx"
  ON "RecentlyViewed"("userId", "viewedAt" DESC);

ALTER TABLE "RecentlyViewed"
  ADD CONSTRAINT "RecentlyViewed_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RecentlyViewed"
  ADD CONSTRAINT "RecentlyViewed_listingId_fkey"
  FOREIGN KEY ("listingId") REFERENCES "Listing"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
