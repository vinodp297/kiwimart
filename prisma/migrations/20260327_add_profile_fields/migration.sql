-- Sprint: Profile pictures + seller onboarding fields
-- Safe to re-run: all statements use IF NOT EXISTS / IF EXISTS guards.
-- Applies missing columns that were added to schema.prisma but never migrated.

-- ── User profile columns ────────────────────────────────────────────────────
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "avatarKey"          TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "coverImageKey"      TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "bio"                TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "phone"              TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "phoneVerified"      BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "phoneVerifiedAt"    TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "dateOfBirth"        TIMESTAMP(3);

-- ── User location columns ───────────────────────────────────────────────────
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "region"             TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "suburb"             TEXT;

-- ── User verification columns ───────────────────────────────────────────────
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "idVerified"         BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "idVerifiedAt"       TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "idSubmittedAt"      TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "nzbn"               TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "gstRegistered"      BOOLEAN NOT NULL DEFAULT false;

-- ── Seller settings columns ─────────────────────────────────────────────────
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "sellerTermsAcceptedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "sellerEnabled"      BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "stripeAccountId"    TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "stripeOnboarded"    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "stripeChargesEnabled"  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "stripePayoutsEnabled"  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "payoutBankAccount"  TEXT;

-- ── User flag columns ───────────────────────────────────────────────────────
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isBanned"           BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "bannedAt"           TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "bannedReason"       TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isAdmin"            BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "adminRole"          TEXT;

-- ── Onboarding columns ─────────────────────────────────────────────────────
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "onboardingCompleted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "onboardingIntent"   TEXT;

-- ── Privacy columns ────────────────────────────────────────────────────────
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "agreeMarketing"     BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "agreedTermsAt"      TIMESTAMP(3);

-- ── Email verification columns ─────────────────────────────────────────────
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailVerifyToken"   TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailVerifyExpires" TIMESTAMP(3);

-- ── Unique constraints (idempotent: drop if exists, then create) ───────────
-- nzbn unique
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'User_nzbn_key') THEN
    ALTER TABLE "User" ADD CONSTRAINT "User_nzbn_key" UNIQUE ("nzbn");
  END IF;
END $$;

-- stripeAccountId unique
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'User_stripeAccountId_key') THEN
    ALTER TABLE "User" ADD CONSTRAINT "User_stripeAccountId_key" UNIQUE ("stripeAccountId");
  END IF;
END $$;

-- emailVerifyToken unique
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'User_emailVerifyToken_key') THEN
    ALTER TABLE "User" ADD CONSTRAINT "User_emailVerifyToken_key" UNIQUE ("emailVerifyToken");
  END IF;
END $$;

-- ── Listing quick-filter / price-drop columns ──────────────────────────────
ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "isUrgent"          BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "isNegotiable"      BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "shipsNationwide"   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "previousPriceNzd"  INTEGER;
ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "priceDroppedAt"    TIMESTAMP(3);

-- ── ListingImage processing columns ────────────────────────────────────────
ALTER TABLE "ListingImage" ADD COLUMN IF NOT EXISTS "sizeBytes"         INTEGER;
ALTER TABLE "ListingImage" ADD COLUMN IF NOT EXISTS "thumbnailKey"      TEXT;
ALTER TABLE "ListingImage" ADD COLUMN IF NOT EXISTS "processedAt"       TIMESTAMP(3);
ALTER TABLE "ListingImage" ADD COLUMN IF NOT EXISTS "originalSizeBytes" INTEGER;
