-- CreateTable
CREATE TABLE "SubAccountUsage" (
    "id" TEXT NOT NULL,
    "subAccountId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "percent" DOUBLE PRECISION NOT NULL,
    "resetAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubAccountUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SubAccountUsage_subAccountId_idx" ON "SubAccountUsage"("subAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "SubAccountUsage_subAccountId_metric_key" ON "SubAccountUsage"("subAccountId", "metric");

-- AddForeignKey
ALTER TABLE "SubAccountUsage" ADD CONSTRAINT "SubAccountUsage_subAccountId_fkey" FOREIGN KEY ("subAccountId") REFERENCES "SubAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
