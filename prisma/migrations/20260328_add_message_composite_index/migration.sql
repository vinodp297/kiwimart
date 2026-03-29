-- Composite index on Message (senderId, createdAt DESC)
-- Optimises queries that fetch a user's messages sorted by recency,
-- such as response-time calculation in response-metrics.service.ts.

CREATE INDEX IF NOT EXISTS "Message_senderId_createdAt_idx"
  ON "Message" ("senderId", "createdAt" DESC);
