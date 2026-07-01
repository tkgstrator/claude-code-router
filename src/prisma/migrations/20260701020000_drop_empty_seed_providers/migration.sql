-- Clear out placeholder seed Provider rows that older builds inserted
-- via ensureSeedProviders() so the Providers page could show them under
-- "unavailable". The Providers page now reads a catalog view over the
-- static shared/data seed and only writes a Provider row when the user
-- explicitly enables a vendor — leaving those empty rows around clutters
-- the UI and gives the false impression the vendors are "installed".
--
-- Only rows with:
--   - a name in the known seed set (VENDOR_DEFAULTS ids + SUBSCRIPTION_PRESETS ids)
--   - no apiKey configured
--   - no SubAccount rows attached
-- are removed. User-added providers, and any seed provider the user has
-- actually configured, stay put. RouterSlot.modelId has ON DELETE
-- RESTRICT so its bindings to soon-to-be-deleted Models are nulled
-- first; Provider deletion then cascades to Model and SubAccount.

UPDATE "RouterSlot"
SET "modelId" = NULL
WHERE "modelId" IN (
  SELECT "Model"."id"
  FROM "Model"
  JOIN "Provider" ON "Provider"."id" = "Model"."providerId"
  WHERE "Provider"."name" IN (
      'anthropic', 'deepseek', 'google', 'minimax', 'mistral',
      'moonshot-ai', 'openai', 'qwen', 'xai',
      'claude-code', 'codex'
    )
    AND ("Provider"."apiKey" IS NULL OR "Provider"."apiKey" = '')
    AND NOT EXISTS (
      SELECT 1 FROM "SubAccount"
      WHERE "SubAccount"."providerId" = "Provider"."id"
    )
);

DELETE FROM "Provider"
WHERE "Provider"."name" IN (
    'anthropic', 'deepseek', 'google', 'minimax', 'mistral',
    'moonshot-ai', 'openai', 'qwen', 'xai',
    'claude-code', 'codex'
  )
  AND ("Provider"."apiKey" IS NULL OR "Provider"."apiKey" = '')
  AND NOT EXISTS (
    SELECT 1 FROM "SubAccount"
    WHERE "SubAccount"."providerId" = "Provider"."id"
  );
