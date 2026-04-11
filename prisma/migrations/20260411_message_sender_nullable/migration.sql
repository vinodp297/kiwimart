-- Migration: make Message.senderId nullable for GDPR/Privacy Act erasure
-- Allows performAccountErasure() to anonymise messages (set senderId = NULL)
-- instead of hard-deleting them, preserving dispute/chargeback evidence.
-- The DB constraint is changed from RESTRICT to SET NULL so Prisma's onDelete
-- directive is honoured automatically on User deletion as well.

ALTER TABLE "Message" ALTER COLUMN "senderId" DROP NOT NULL;

ALTER TABLE "Message" DROP CONSTRAINT IF EXISTS "Message_senderId_fkey";
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey"
  FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
