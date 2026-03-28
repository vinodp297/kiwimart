-- Make ListingImage.listingId nullable (pending uploads use NULL instead of 'pending' sentinel)
ALTER TABLE "ListingImage" ALTER COLUMN "listingId" DROP NOT NULL;

-- Convert existing 'pending' sentinel values to NULL
UPDATE "ListingImage" SET "listingId" = NULL WHERE "listingId" = 'pending';

-- Drop the unique constraint on (listingId, order) since listingId is now nullable
-- (NULL values in unique constraints behave differently across databases)
DROP INDEX IF EXISTS "ListingImage_listingId_order_key";
