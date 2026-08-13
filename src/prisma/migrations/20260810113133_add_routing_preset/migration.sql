-- CreateTable
CREATE TABLE "RoutingPreset" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoutingPreset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoutingPreset_updatedAt_idx" ON "RoutingPreset"("updatedAt");
