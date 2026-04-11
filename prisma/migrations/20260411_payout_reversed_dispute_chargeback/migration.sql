-- Migration: add PayoutStatus.REVERSED and DisputeSource.CHARGEBACK
-- REVERSED distinguishes a reversed transfer from a failed one.
-- CHARGEBACK distinguishes bank chargebacks from platform disputes.

ALTER TYPE "PayoutStatus" ADD VALUE IF NOT EXISTS 'REVERSED';
ALTER TYPE "DisputeSource" ADD VALUE IF NOT EXISTS 'CHARGEBACK';
