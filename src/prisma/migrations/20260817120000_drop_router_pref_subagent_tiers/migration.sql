-- Drop the deprecated `subagentTiers` per-entry column. Its purpose
-- (restrict which subagent calls a preference entry matches) was
-- superseded by the (scenario, kind) split — the `kind` column now
-- gates the agent/subagent lane entirely, so an entry either
-- participates in a lane or doesn't, no per-entry tier filter needed.
-- No pre-migration data preserved: rows migrated to agent-kind lost
-- their tier filters in the earlier split, and no reader consulted
-- the column afterward.
ALTER TABLE "RouterPreferenceEntry" DROP COLUMN "subagentTiers";
