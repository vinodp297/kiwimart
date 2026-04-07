-- CreateTable
CREATE TABLE "ErasureLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "scope" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErasureLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ErasureLog_userId_idx" ON "ErasureLog"("userId");

-- CreateIndex
CREATE INDEX "ErasureLog_createdAt_idx" ON "ErasureLog"("createdAt" DESC);
