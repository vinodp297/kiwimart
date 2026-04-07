-- CreateTable: CronLog for job execution tracking
-- Idempotent: uses IF NOT EXISTS guards.

CREATE TABLE IF NOT EXISTS "CronLog" (
    "id" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CronLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CronLog_jobName_startedAt_idx" ON "CronLog"("jobName", "startedAt" DESC);
CREATE INDEX IF NOT EXISTS "CronLog_startedAt_idx" ON "CronLog"("startedAt" DESC);
