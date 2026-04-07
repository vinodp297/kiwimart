-- Rename AdminInvitation.token → tokenHash
-- The raw token is no longer stored; only the SHA-256 hash is persisted.
-- Existing rows: the previously-stored raw token value becomes a "hash" —
-- any pending invitations should be re-issued after this migration.
-- Idempotent: RENAME is skipped if old column no longer exists.

-- Drop old index (safe if not exists)
DROP INDEX IF EXISTS "AdminInvitation_token_key";
DROP INDEX IF EXISTS "AdminInvitation_token_idx";

-- Rename column only if old name still exists
DO $$BEGIN
  IF EXISTS (
    SELECT FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name  = 'AdminInvitation'
      AND column_name = 'token'
  ) THEN
    ALTER TABLE "AdminInvitation" RENAME COLUMN "token" TO "tokenHash";
  END IF;
END$$;

-- Re-create unique constraint and index on the new column name (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS "AdminInvitation_tokenHash_key" ON "AdminInvitation"("tokenHash");
CREATE INDEX IF NOT EXISTS "AdminInvitation_tokenHash_idx" ON "AdminInvitation"("tokenHash");
