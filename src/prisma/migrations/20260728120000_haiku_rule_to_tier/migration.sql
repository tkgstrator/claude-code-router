-- The prior migration (`20260728_router_rules_drop_background`) folded
-- each background RouterSlot into a haiku-glob rule on the default
-- slot: `{ "when": { "requestedModel": "*haiku*" }, ... }`. Since then
-- the rule editor learned about the `requestedTier` predicate (a
-- 4-choice enum surfaced as checkboxes) and stopped exposing the raw
-- `requestedModel` glob in the UI, so those migrated rules were
-- visible in the summary line but not editable from the panel.
--
-- This follow-up rewrites every rule whose `when.requestedModel`
-- happens to be a tier glob (`*<tier>*` for one of the four Claude
-- families) into the equivalent `requestedTier: ['<tier>']` form, so
-- the UI's tier checkboxes can now edit them and the summary reads
-- `tier:haiku` instead of `model:*haiku*`. Rules whose glob doesn't
-- match a known tier are left alone — power users still using glob
-- predicates keep their configs.
--
-- Applied to both agentRules and subagentRules on every RouterSlot.

-- Convert one rule JSONB: if its `when.requestedModel` matches
-- `*<tier>*` for one of the four families, swap it for
-- `when.requestedTier: ['<tier>']` and drop `requestedModel`.
-- Otherwise return the rule unchanged.
CREATE OR REPLACE FUNCTION _convert_rule_to_tier(rule JSONB) RETURNS JSONB AS $$
DECLARE
  glob TEXT;
  matched_tier TEXT;
  new_when JSONB;
BEGIN
  glob := rule -> 'when' ->> 'requestedModel';
  IF glob IS NULL THEN
    RETURN rule;
  END IF;
  matched_tier := CASE
    WHEN glob = '*fable*'  THEN 'fable'
    WHEN glob = '*opus*'   THEN 'opus'
    WHEN glob = '*sonnet*' THEN 'sonnet'
    WHEN glob = '*haiku*'  THEN 'haiku'
    ELSE NULL
  END;
  IF matched_tier IS NULL THEN
    RETURN rule;
  END IF;
  -- Build the new `when` object: drop requestedModel, add
  -- requestedTier. Preserve any other predicate fields (thinking,
  -- minTokens, hasTool, effort, …).
  new_when := (rule -> 'when') - 'requestedModel'
    || jsonb_build_object('requestedTier', jsonb_build_array(matched_tier));
  RETURN rule || jsonb_build_object('when', new_when);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

DO $$
DECLARE
  slot RECORD;
  updated_agent_rules JSONB;
  updated_subagent_rules JSONB;
BEGIN
  FOR slot IN SELECT id, params FROM "RouterSlot" WHERE params IS NOT NULL LOOP
    updated_agent_rules := (
      SELECT jsonb_agg(_convert_rule_to_tier(rule))
      FROM jsonb_array_elements(COALESCE(slot.params -> 'agentRules', '[]'::jsonb)) rule
    );
    updated_subagent_rules := (
      SELECT jsonb_agg(_convert_rule_to_tier(rule))
      FROM jsonb_array_elements(COALESCE(slot.params -> 'subagentRules', '[]'::jsonb)) rule
    );

    UPDATE "RouterSlot"
    SET params = params
      || (CASE
          WHEN updated_agent_rules IS NOT NULL
          THEN jsonb_build_object('agentRules', updated_agent_rules)
          ELSE '{}'::jsonb
      END)
      || (CASE
          WHEN updated_subagent_rules IS NOT NULL
          THEN jsonb_build_object('subagentRules', updated_subagent_rules)
          ELSE '{}'::jsonb
      END)
    WHERE id = slot.id;
  END LOOP;
END $$;

-- Drop the helper — the migration is one-shot; leaving a function in
-- the public schema pollutes the DB for no reason.
DROP FUNCTION _convert_rule_to_tier(JSONB);
