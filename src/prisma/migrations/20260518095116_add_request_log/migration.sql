-- CreateTable
CREATE TABLE "RequestLog" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
    "totalInputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheHitPct" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "status" INTEGER NOT NULL DEFAULT 200,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RequestLog_createdAt_idx" ON "RequestLog"("createdAt");

-- CreateIndex
CREATE INDEX "RequestLog_provider_model_idx" ON "RequestLog"("provider", "model");
