-- Drop the legacy duplicate claude-code-2 subscription Provider.
-- The seed used to register two rows ("claude-code" and "claude-code-2");
-- the data model now supports N SubAccounts per Provider, so the duplicate
-- is no longer needed.
--
-- RouterSlot.modelId has ON DELETE RESTRICT, so any slot bound to a
-- claude-code-2 Model must be nulled before the Provider can be deleted.
-- Provider deletion cascades to Model and SubAccount.

UPDATE "RouterSlot"
SET "modelId" = NULL
WHERE "modelId" IN (
  SELECT "Model"."id"
  FROM "Model"
  JOIN "Provider" ON "Provider"."id" = "Model"."providerId"
  WHERE "Provider"."name" = 'claude-code-2'
);

DELETE FROM "Provider" WHERE "name" = 'claude-code-2';
