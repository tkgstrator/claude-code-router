-- Add per-account enable/disable switch.
-- Existing rows default to enabled so behavior is unchanged until the
-- user explicitly turns one off in the provider editor.

ALTER TABLE "SubAccount"
  ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true;
