-- Trust & Reputation + Discovery & Search Features
-- Safe to re-run: all statements use IF NOT EXISTS / IF EXISTS guards.

-- ── User: seller verification fields ────────────────────────────────────────
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isVerifiedSeller" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "verifiedSellerAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "avgResponseTimeMinutes" INTEGER;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "responseRate" DOUBLE PRECISION;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastResponseCalcAt" TIMESTAMP(3);

-- ── User: radius search fields ──────────────────────────────────────────────
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "searchLat" DOUBLE PRECISION;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "searchLng" DOUBLE PRECISION;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "searchRadius" INTEGER DEFAULT 50;

-- ── Listing: location coordinates ───────────────────────────────────────────
ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "locationLat" DOUBLE PRECISION;
ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "locationLng" DOUBLE PRECISION;
CREATE INDEX IF NOT EXISTS "Listing_locationLat_locationLng_idx" ON "Listing"("locationLat", "locationLng");

-- ── WatchlistItem: price alert fields ───────────────────────────────────────
ALTER TABLE "WatchlistItem" ADD COLUMN IF NOT EXISTS "priceAlertEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "WatchlistItem" ADD COLUMN IF NOT EXISTS "priceAtWatch" INTEGER;

-- ── Enums ───────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SELLER_VERIFICATION_APPLIED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SELLER_VERIFICATION_APPROVED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SELLER_VERIFICATION_REJECTED';

-- ── VerificationApplication table ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "VerificationApplication" (
    "id"         TEXT NOT NULL,
    "sellerId"   TEXT NOT NULL,
    "status"     "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "appliedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "adminNotes" TEXT,

    CONSTRAINT "VerificationApplication_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "VerificationApplication_sellerId_key" ON "VerificationApplication"("sellerId");
CREATE INDEX IF NOT EXISTS "VerificationApplication_status_idx" ON "VerificationApplication"("status");

ALTER TABLE "VerificationApplication" DROP CONSTRAINT IF EXISTS "VerificationApplication_sellerId_fkey";
ALTER TABLE "VerificationApplication" ADD CONSTRAINT "VerificationApplication_sellerId_fkey"
    FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── ListingPriceHistory table ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ListingPriceHistory" (
    "id"        TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "priceNzd"  INTEGER NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListingPriceHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ListingPriceHistory_listingId_changedAt_idx" ON "ListingPriceHistory"("listingId", "changedAt");

ALTER TABLE "ListingPriceHistory" DROP CONSTRAINT IF EXISTS "ListingPriceHistory_listingId_fkey";
ALTER TABLE "ListingPriceHistory" ADD CONSTRAINT "ListingPriceHistory_listingId_fkey"
    FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
