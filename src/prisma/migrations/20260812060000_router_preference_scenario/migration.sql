-- DropIndex
DROP INDEX "RouterPreferenceEntry_profileId_priority_key";
-- AlterTable
ALTER TABLE "RouterPreferenceEntry" ADD COLUMN     "scenario" "ScenarioKey" NOT NULL DEFAULT 'default';
-- CreateIndex
CREATE INDEX "RouterPreferenceEntry_profileId_scenario_idx" ON "RouterPreferenceEntry"("profileId", "scenario");
-- CreateIndex
CREATE UNIQUE INDEX "RouterPreferenceEntry_profileId_scenario_priority_key" ON "RouterPreferenceEntry"("profileId", "scenario", "priority");
