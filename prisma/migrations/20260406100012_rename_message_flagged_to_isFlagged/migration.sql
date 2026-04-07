-- Rename boolean: Message.flagged → isFlagged
-- Idempotent: skips if old column no longer exists (fresh install via initial migration).
DO $$BEGIN
  IF EXISTS (
    SELECT FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name  = 'Message'
      AND column_name = 'flagged'
  ) THEN
    ALTER TABLE "Message" RENAME COLUMN "flagged" TO "isFlagged";
  END IF;
END$$;
