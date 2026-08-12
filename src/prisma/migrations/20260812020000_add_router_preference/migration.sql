-- CreateTable
CREATE TABLE "RouterPreferenceProfile" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL DEFAULT 'live',
    "constraints" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RouterPreferenceProfile_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "RouterPreferenceEntry" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "modelId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "subagentTiers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    CONSTRAINT "RouterPreferenceEntry_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "RouterPreferenceProfile_key_key" ON "RouterPreferenceProfile"("key");
-- CreateIndex
CREATE INDEX "RouterPreferenceEntry_profileId_idx" ON "RouterPreferenceEntry"("profileId");
-- CreateIndex
CREATE UNIQUE INDEX "RouterPreferenceEntry_profileId_priority_key" ON "RouterPreferenceEntry"("profileId", "priority");
-- AddForeignKey
ALTER TABLE "RouterPreferenceEntry" ADD CONSTRAINT "RouterPreferenceEntry_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "RouterPreferenceProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "RouterPreferenceEntry" ADD CONSTRAINT "RouterPreferenceEntry_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "Model"("id") ON DELETE CASCADE ON UPDATE CASCADE;
