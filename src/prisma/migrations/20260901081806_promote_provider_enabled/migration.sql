-- Promote the provider-level on/off switch out of the `transformer`
-- JSONB and into a real column.
--
-- Order matters. The generated form of this migration dropped the blob
-- and added the column in one statement, which would have silently
-- re-enabled every provider an operator had turned off: the new column's
-- DEFAULT true would apply to rows whose stored value said false. The
-- flag has to be copied across while the blob still exists.

-- 1. Add the column. Enabled is the right default for every row that
--    never carried the key, because the blob's absence meant enabled.
ALTER TABLE "Provider" ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true;

-- 2. Carry the one value that was ever written. `providerEnabled` was
--    only ever persisted as the literal `false` (see the old
--    buildStoredTransformer); absent / null / true all meant enabled, and
--    a NULL blob compares to NULL here, so those rows keep the default.
UPDATE "Provider"
   SET "enabled" = false
 WHERE "transformer" -> 'providerEnabled' = 'false'::jsonb;

-- 3. Only then drop the blob. Its other two tenants do not belong in this
--    table: `_disabledModels` was a derived view of Model.enabled, rebuilt
--    on every read and stripped before every write, and `subscriptionAuth`
--    is the OAuth credential the pipeline grafts on at request time —
--    persisting that would have written a live secret to disk.
ALTER TABLE "Provider" DROP COLUMN "transformer";
