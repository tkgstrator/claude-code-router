-- CreateTable
CREATE TABLE "UsageSample" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "percent" DOUBLE PRECISION NOT NULL,
    "resetAt" TIMESTAMP(3),
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageSample_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UsageSample_provider_metric_capturedAt_idx" ON "UsageSample"("provider", "metric", "capturedAt");

-- CreateIndex
CREATE INDEX "UsageSample_capturedAt_idx" ON "UsageSample"("capturedAt");
