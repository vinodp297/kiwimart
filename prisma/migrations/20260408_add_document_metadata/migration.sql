-- Migration: add_document_metadata
-- Adds four optional columns to VerificationApplication to store validation
-- metadata captured during the KYC document upload security pipeline.
-- Sprint 4A — security hardening.

ALTER TABLE "VerificationApplication"
  ADD COLUMN "documentFormat"    TEXT,
  ADD COLUMN "documentSizeBytes" INTEGER,
  ADD COLUMN "documentWidth"     INTEGER,
  ADD COLUMN "documentHeight"    INTEGER;
