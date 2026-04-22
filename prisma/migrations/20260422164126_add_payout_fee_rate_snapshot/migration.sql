-- AlterTable
-- Platform fee rate snapshotted at first payout worker pickup.
-- Stored in basis points (350 = 3.5%) to avoid float precision issues.
-- 0 = legacy row created before this field existed — worker falls back
-- to live PlatformConfig (matches pre-migration behaviour exactly).
ALTER TABLE "Payout" ADD COLUMN "effectiveFeeRateBps" INTEGER NOT NULL DEFAULT 0;
