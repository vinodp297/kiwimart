-- Rename FK column: AdminInvitation.invitedBy → invitedById
-- Idempotent: skips if old column no longer exists (fresh install via initial migration).
DO $$BEGIN
  IF EXISTS (
    SELECT FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name  = 'AdminInvitation'
      AND column_name = 'invitedBy'
  ) THEN
    ALTER TABLE "AdminInvitation" RENAME COLUMN "invitedBy" TO "invitedById";
  END IF;
END$$;
