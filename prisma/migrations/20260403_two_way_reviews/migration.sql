-- Two-way reviews: buyer↔seller review system
-- Renames columns (preserves data), adds ReviewerRole enum, changes unique constraint

-- 1. Create the ReviewerRole enum
CREATE TYPE "ReviewerRole" AS ENUM ('BUYER', 'SELLER');

-- 2. Rename columns (data-preserving)
ALTER TABLE "Review" RENAME COLUMN "sellerId" TO "subjectId";
ALTER TABLE "Review" RENAME COLUMN "sellerReply" TO "reply";
ALTER TABLE "Review" RENAME COLUMN "sellerRepliedAt" TO "repliedAt";

-- 3. Add reviewerRole column with default (existing reviews are all BUYER)
ALTER TABLE "Review" ADD COLUMN "reviewerRole" "ReviewerRole" NOT NULL DEFAULT 'BUYER';

-- 4. Drop the old unique constraint on orderId (one review per order)
ALTER TABLE "Review" DROP CONSTRAINT IF EXISTS "Review_orderId_key";

-- 5. Add new composite unique (one review per role per order)
ALTER TABLE "Review" ADD CONSTRAINT "Review_orderId_reviewerRole_key" UNIQUE ("orderId", "reviewerRole");

-- 6. Rename the index on subjectId (was sellerId)
DROP INDEX IF EXISTS "Review_sellerId_idx";
CREATE INDEX "Review_subjectId_idx" ON "Review"("subjectId");
