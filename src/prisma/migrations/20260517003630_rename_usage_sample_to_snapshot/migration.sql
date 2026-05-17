/*
  Warnings:

  - You are about to drop the `UsageSample` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "UsageSample";

-- CreateTable
CREATE TABLE "UsageSnapshot" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "percent" DOUBLE PRECISION NOT NULL,
    "resetAt" TIMESTAMP(3),
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UsageSnapshot_provider_metric_capturedAt_idx" ON "UsageSnapshot"("provider", "metric", "capturedAt");

-- CreateIndex
CREATE INDEX "UsageSnapshot_capturedAt_idx" ON "UsageSnapshot"("capturedAt");
