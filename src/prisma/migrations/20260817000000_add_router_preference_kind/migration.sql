-- Split the RouterPreferenceEntry chain into two per-scenario lanes
-- (agent / subagent) so operators can order the subagent chain
-- independently of the agent one. Pre-migration rows all become the
-- agent lane; subagent chains start empty and the UI populates them.

-- CreateEnum
CREATE TYPE "RouterPreferenceKind" AS ENUM ('agent', 'subagent');

-- AlterTable: add the new column defaulting to 'agent' so existing
-- rows land there without a separate UPDATE. New writes must set
-- kind explicitly (the default stays for defensive backfill).
ALTER TABLE "RouterPreferenceEntry"
ADD COLUMN "kind" "RouterPreferenceKind" NOT NULL DEFAULT 'agent';

-- DropIndex: the old uniqueness / lookup indexes were keyed on
-- (profileId, scenario, priority) — kind now participates in both.
DROP INDEX "RouterPreferenceEntry_profileId_scenario_priority_key";
DROP INDEX "RouterPreferenceEntry_profileId_scenario_idx";

-- CreateIndex: new uniqueness includes kind so each (scenario, kind)
-- chain has its own total ordering.
CREATE UNIQUE INDEX "RouterPreferenceEntry_profileId_scenario_kind_priority_key"
ON "RouterPreferenceEntry"("profileId", "scenario", "kind", "priority");
CREATE INDEX "RouterPreferenceEntry_profileId_scenario_kind_idx"
ON "RouterPreferenceEntry"("profileId", "scenario", "kind");
