-- CreateTable
CREATE TABLE "SubAccountQuota" (
    "id" TEXT NOT NULL,
    "subAccountId" TEXT NOT NULL,
    "fiveHourUsed" DOUBLE PRECISION,
    "fiveHourLimit" DOUBLE PRECISION,
    "fiveHourResetAt" TIMESTAMP(3),
    "fiveHourWindowSeconds" INTEGER,
    "weeklyUsed" DOUBLE PRECISION,
    "weeklyLimit" DOUBLE PRECISION,
    "weeklyResetAt" TIMESTAMP(3),
    "weeklyWindowSeconds" INTEGER,
    "scopedWindows" JSONB,
    "lastRateLimitedAt" TIMESTAMP(3),
    "lastRateLimitStatus" INTEGER,
    "lastRetryAfterSec" INTEGER,
    "headerRemaining" DOUBLE PRECISION,
    "headerResetAt" TIMESTAMP(3),
    "quotaRefreshedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SubAccountQuota_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "RoutingWeightChange" (
    "id" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "fromWeight" DOUBLE PRECISION NOT NULL,
    "toWeight" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "tickAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RoutingWeightChange_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "SubAccountQuota_subAccountId_key" ON "SubAccountQuota"("subAccountId");
-- CreateIndex
CREATE INDEX "RoutingWeightChange_createdAt_idx" ON "RoutingWeightChange"("createdAt");
-- CreateIndex
CREATE INDEX "RoutingWeightChange_target_createdAt_idx" ON "RoutingWeightChange"("target", "createdAt");
-- AddForeignKey
ALTER TABLE "SubAccountQuota" ADD CONSTRAINT "SubAccountQuota_subAccountId_fkey" FOREIGN KEY ("subAccountId") REFERENCES "SubAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
