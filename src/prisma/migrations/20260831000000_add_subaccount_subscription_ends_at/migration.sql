-- Split the two facts Codex rows used to cram into `expiresAt`.
--
-- `expiresAt` now means the ACCESS TOKEN's expiry for every vendor
-- (Claude already used it that way). The subscription's own end date,
-- read from the id_token's `chatgpt_subscription_active_until`, moves
-- here. Existing Codex rows keep a subscription end date in `expiresAt`
-- until their next refresh rewrites it; nothing reads it as an access
-- token expiry any more, because freshness is decided from the token's
-- own `exp` claim.
ALTER TABLE "SubAccount" ADD COLUMN "subscriptionEndsAt" TIMESTAMP(3);
