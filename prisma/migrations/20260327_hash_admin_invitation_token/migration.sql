-- Rename AdminInvitation.token → tokenHash
-- The raw token is no longer stored; only the SHA-256 hash is persisted.
-- Existing rows: the previously-stored raw token value becomes a "hash" —
-- any pending invitations should be re-issued after this migration.

-- Drop old index
DROP INDEX IF EXISTS "AdminInvitation_token_key";
DROP INDEX IF EXISTS "AdminInvitation_token_idx";

-- Rename column
ALTER TABLE "AdminInvitation" RENAME COLUMN "token" TO "tokenHash";

-- Re-create unique constraint and index on the new column name
CREATE UNIQUE INDEX "AdminInvitation_tokenHash_key" ON "AdminInvitation"("tokenHash");
CREATE INDEX "AdminInvitation_tokenHash_idx" ON "AdminInvitation"("tokenHash");
