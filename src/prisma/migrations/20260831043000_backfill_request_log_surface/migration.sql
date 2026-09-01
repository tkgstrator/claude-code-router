-- Backfill RequestLog.surface where the mapping is exact.
--
-- `inboundType = 'anthropic'` can only have come from /v1/messages, so
-- those rows recover their surface losslessly.
--
-- `inboundType = 'openai'` covers BOTH /v1/chat/completions and
-- /v1/responses, and nothing else on the row distinguishes them. Those
-- stay NULL rather than being guessed — the Overview and Activity
-- breakdowns report them as untracked, which is true, instead of
-- attributing traffic to a surface that may not have served it.

UPDATE "RequestLog"
   SET "surface" = 'anthropic-messages'
 WHERE "surface" IS NULL
   AND "inboundType" = 'anthropic';
