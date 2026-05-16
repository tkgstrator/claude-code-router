-- AlterTable
ALTER TABLE "Model" ADD COLUMN     "enabled" BOOLEAN NOT NULL DEFAULT true;

-- Backfill: deprecated / legacy models start disabled (matches the
-- "deprecated default off" rule). Non-reset upgrades keep everything
-- else enabled; the seed re-asserts this for fresh rows.
UPDATE "Model" SET "enabled" = false WHERE "deprecated" = true OR "legacy" = true;
