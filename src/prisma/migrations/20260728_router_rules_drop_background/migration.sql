-- Fold the `background` RouterSlot config into a predicated rule on the
-- `default` slot before dropping the enum value. The rule matches when
-- the client's requested model contains "haiku" (glob "*haiku*") —
-- exactly the behavior of the previous isHaiku → background branch.
--
-- Idempotent: if there is no background row, the UPDATE hits no rows and
-- the subsequent enum swap runs unconditionally against a table already
-- free of the value.

DO $$
DECLARE
  bg_agent_primary TEXT;
  bg_subagent_primary TEXT;
  bg_agent_fallbacks JSONB;
  bg_subagent_fallbacks JSONB;
  bg_exists BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM "RouterSlot" WHERE "scenario" = 'background') INTO bg_exists;

  IF bg_exists THEN
    SELECT
      -- Assemble "providerName,modelName" from the FK columns for both
      -- agent and subagent primaries.
      (SELECT p.name || ',' || m.name
         FROM "Model" m JOIN "Provider" p ON p.id = m."providerId"
        WHERE m.id = bg."modelId"),
      (SELECT p.name || ',' || m.name
         FROM "Model" m JOIN "Provider" p ON p.id = m."providerId"
        WHERE m.id = bg."subagentModelId"),
      COALESCE(bg.params -> 'fallbacks', '[]'::jsonb),
      COALESCE(bg.params -> 'subagentFallbacks', '[]'::jsonb)
    INTO bg_agent_primary, bg_subagent_primary, bg_agent_fallbacks, bg_subagent_fallbacks
    FROM "RouterSlot" bg
    WHERE bg."scenario" = 'background';

    -- Only prepend a rule when there is actually a primary to route to.
    -- A background row with both primaries NULL is effectively unset and
    -- would produce a rule that matches haiku but points nowhere, which
    -- is worse than leaving the request on the default lane.
    UPDATE "RouterSlot" AS d
    SET params = COALESCE(d.params, '{}'::jsonb) ||
      jsonb_build_object(
        'agentRules',
        COALESCE(d.params -> 'agentRules', '[]'::jsonb) ||
          CASE WHEN bg_agent_primary IS NOT NULL THEN
            jsonb_build_array(
              jsonb_build_object(
                'name', 'haiku (migrated from background)',
                'when', jsonb_build_object('requestedTier', jsonb_build_array('haiku')),
                'primary', bg_agent_primary,
                'fallbacks', bg_agent_fallbacks
              )
            )
          ELSE '[]'::jsonb END,
        'subagentRules',
        COALESCE(d.params -> 'subagentRules', '[]'::jsonb) ||
          CASE WHEN bg_subagent_primary IS NOT NULL THEN
            jsonb_build_array(
              jsonb_build_object(
                'name', 'haiku (migrated from background)',
                'when', jsonb_build_object('requestedTier', jsonb_build_array('haiku')),
                'primary', bg_subagent_primary,
                'fallbacks', bg_subagent_fallbacks
              )
            )
          ELSE '[]'::jsonb END
      )
    WHERE d."scenario" = 'default';

    -- Drop the background row before swapping the enum, since the enum
    -- swap requires no existing row to reference the value being removed.
    DELETE FROM "RouterSlot" WHERE "scenario" = 'background';
  END IF;
END $$;

-- Swap ScenarioKey enum, removing the `background` variant. PostgreSQL
-- does not support ALTER TYPE ... DROP VALUE, so we build a new enum
-- and cast the column across.
CREATE TYPE "ScenarioKey_new" AS ENUM ('default', 'think', 'longContext', 'webSearch', 'image');
ALTER TABLE "RouterSlot"
  ALTER COLUMN "scenario" TYPE "ScenarioKey_new" USING ("scenario"::text::"ScenarioKey_new");
DROP TYPE "ScenarioKey";
ALTER TYPE "ScenarioKey_new" RENAME TO "ScenarioKey";
