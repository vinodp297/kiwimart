-- Two-way reviews: buyer↔seller review system
-- Renames columns (preserves data), adds ReviewerRole enum, changes unique constraint
-- Idempotent: all RENAME operations guarded by IF EXISTS checks.

-- 1. Create the ReviewerRole enum
DO $$BEGIN
  CREATE TYPE "ReviewerRole" AS ENUM ('BUYER', 'SELLER');
EXCEPTION WHEN duplicate_object THEN NULL;
END$$;

-- 2. Rename columns (data-preserving) — skip if old name no longer exists
DO $$BEGIN
  IF EXISTS (
    SELECT FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Review' AND column_name = 'sellerId'
  ) THEN
    ALTER TABLE "Review" RENAME COLUMN "sellerId" TO "subjectId";
  END IF;
END$$;

DO $$BEGIN
  IF EXISTS (
    SELECT FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Review' AND column_name = 'sellerReply'
  ) THEN
    ALTER TABLE "Review" RENAME COLUMN "sellerReply" TO "reply";
  END IF;
END$$;

DO $$BEGIN
  IF EXISTS (
    SELECT FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Review' AND column_name = 'sellerRepliedAt'
  ) THEN
    ALTER TABLE "Review" RENAME COLUMN "sellerRepliedAt" TO "repliedAt";
  END IF;
END$$;

-- 3. Add reviewerRole column with default (existing reviews are all BUYER)
ALTER TABLE "Review" ADD COLUMN IF NOT EXISTS "reviewerRole" "ReviewerRole" NOT NULL DEFAULT 'BUYER';

-- 4. Drop the old unique constraint on orderId (one review per order)
ALTER TABLE "Review" DROP CONSTRAINT IF EXISTS "Review_orderId_key";

-- 5. Add new composite unique (one review per role per order)
DO $$BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'Review_orderId_reviewerRole_key')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Review_orderId_reviewerRole_key') THEN
    ALTER TABLE "Review" ADD CONSTRAINT "Review_orderId_reviewerRole_key" UNIQUE ("orderId", "reviewerRole");
  END IF;
END$$;

-- 6. Rename the index on subjectId (was sellerId)
DROP INDEX IF EXISTS "Review_sellerId_idx";
CREATE INDEX IF NOT EXISTS "Review_subjectId_idx" ON "Review"("subjectId");
