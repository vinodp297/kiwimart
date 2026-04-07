-- Sprint: Profile pictures + seller onboarding fields
-- Safe to re-run: all statements use IF NOT EXISTS / IF EXISTS guards.
-- Applies missing columns that were added to schema.prisma but never migrated.
--
-- Columns that were later renamed use a 3-way check:
--   skip if the old name exists (existing DB — rename migration will handle it)
--   skip if the new name exists (fresh install via initial migration)
--   otherwise add with the old name so the rename migration can process it

-- ── User profile columns ────────────────────────────────────────────────────
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "avatarKey"          TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "coverImageKey"      TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "bio"                TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "phone"              TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "phoneVerifiedAt"    TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "dateOfBirth"        TIMESTAMP(3);

-- phoneVerified → isPhoneVerified (renamed in later migration)
DO $$BEGIN
  IF NOT EXISTS (
    SELECT FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'User'
      AND column_name IN ('phoneVerified', 'isPhoneVerified')
  ) THEN
    ALTER TABLE "User" ADD COLUMN "phoneVerified" BOOLEAN NOT NULL DEFAULT false;
  END IF;
END$$;

-- ── User location columns ───────────────────────────────────────────────────
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "region"             TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "suburb"             TEXT;

-- ── User verification columns ───────────────────────────────────────────────
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "idVerified"         BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "idVerifiedAt"       TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "idSubmittedAt"      TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "nzbn"               TEXT;

-- gstRegistered → isGstRegistered (renamed in later migration)
DO $$BEGIN
  IF NOT EXISTS (
    SELECT FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'User'
      AND column_name IN ('gstRegistered', 'isGstRegistered')
  ) THEN
    ALTER TABLE "User" ADD COLUMN "gstRegistered" BOOLEAN NOT NULL DEFAULT false;
  END IF;
END$$;

-- ── Seller settings columns ─────────────────────────────────────────────────
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "sellerTermsAcceptedAt" TIMESTAMP(3);

-- sellerEnabled → isSellerEnabled (renamed in later migration)
DO $$BEGIN
  IF NOT EXISTS (
    SELECT FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'User'
      AND column_name IN ('sellerEnabled', 'isSellerEnabled')
  ) THEN
    ALTER TABLE "User" ADD COLUMN "sellerEnabled" BOOLEAN NOT NULL DEFAULT true;
  END IF;
END$$;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "stripeAccountId"    TEXT;

-- stripeOnboarded → isStripeOnboarded (renamed in later migration)
DO $$BEGIN
  IF NOT EXISTS (
    SELECT FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'User'
      AND column_name IN ('stripeOnboarded', 'isStripeOnboarded')
  ) THEN
    ALTER TABLE "User" ADD COLUMN "stripeOnboarded" BOOLEAN NOT NULL DEFAULT false;
  END IF;
END$$;

-- stripeChargesEnabled → isStripeChargesEnabled (renamed in later migration)
DO $$BEGIN
  IF NOT EXISTS (
    SELECT FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'User'
      AND column_name IN ('stripeChargesEnabled', 'isStripeChargesEnabled')
  ) THEN
    ALTER TABLE "User" ADD COLUMN "stripeChargesEnabled" BOOLEAN NOT NULL DEFAULT false;
  END IF;
END$$;

-- stripePayoutsEnabled → isStripePayoutsEnabled (renamed in later migration)
DO $$BEGIN
  IF NOT EXISTS (
    SELECT FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'User'
      AND column_name IN ('stripePayoutsEnabled', 'isStripePayoutsEnabled')
  ) THEN
    ALTER TABLE "User" ADD COLUMN "stripePayoutsEnabled" BOOLEAN NOT NULL DEFAULT false;
  END IF;
END$$;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "payoutBankAccount"  TEXT;

-- ── User flag columns ───────────────────────────────────────────────────────
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isBanned"           BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "bannedAt"           TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "bannedReason"       TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isAdmin"            BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "adminRole"          TEXT;

-- ── Onboarding columns ─────────────────────────────────────────────────────
-- onboardingCompleted → isOnboardingCompleted (renamed in later migration)
DO $$BEGIN
  IF NOT EXISTS (
    SELECT FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'User'
      AND column_name IN ('onboardingCompleted', 'isOnboardingCompleted')
  ) THEN
    ALTER TABLE "User" ADD COLUMN "onboardingCompleted" BOOLEAN NOT NULL DEFAULT false;
  END IF;
END$$;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "onboardingIntent"   TEXT;

-- ── Privacy columns ────────────────────────────────────────────────────────
-- agreeMarketing → hasMarketingConsent (renamed in later migration)
DO $$BEGIN
  IF NOT EXISTS (
    SELECT FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'User'
      AND column_name IN ('agreeMarketing', 'hasMarketingConsent')
  ) THEN
    ALTER TABLE "User" ADD COLUMN "agreeMarketing" BOOLEAN NOT NULL DEFAULT false;
  END IF;
END$$;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "agreedTermsAt"      TIMESTAMP(3);

-- ── Email verification columns ─────────────────────────────────────────────
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailVerifyToken"   TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailVerifyExpires" TIMESTAMP(3);

-- ── Unique constraints (idempotent) ───────────────────────────────────────
-- Check both pg_constraint (ADD CONSTRAINT) and pg_indexes (CREATE UNIQUE INDEX)
-- since the initial schema migration creates these as indexes, not constraints.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'User_nzbn_key')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'User_nzbn_key') THEN
    ALTER TABLE "User" ADD CONSTRAINT "User_nzbn_key" UNIQUE ("nzbn");
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'User_stripeAccountId_key')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'User_stripeAccountId_key') THEN
    ALTER TABLE "User" ADD CONSTRAINT "User_stripeAccountId_key" UNIQUE ("stripeAccountId");
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'User_emailVerifyToken_key')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'User_emailVerifyToken_key') THEN
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
