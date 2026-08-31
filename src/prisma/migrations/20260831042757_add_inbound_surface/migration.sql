-- AlterTable
ALTER TABLE "RequestLog" ADD COLUMN     "surface" TEXT;

-- CreateTable
CREATE TABLE "InboundSurfaceConfig" (
    "id" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "routingMode" TEXT NOT NULL,
    "profileKey" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboundSurfaceConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InboundSurfaceConfig_surface_key" ON "InboundSurfaceConfig"("surface");

-- CreateIndex
CREATE INDEX "RequestLog_surface_createdAt_idx" ON "RequestLog"("surface", "createdAt");
