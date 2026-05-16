-- Backfill existing rows by vendor before enforcing NOT NULL. The seed
-- (ensureSeedProviders) re-asserts these on every boot, so this only
-- covers the upgrade moment; new rows get the column default.
UPDATE "Provider" SET "apiStyle" = 'anthropic'
  WHERE "apiStyle" IS NULL AND "name" IN ('anthropic', 'claude-code');
UPDATE "Provider" SET "apiStyle" = 'gemini'
  WHERE "apiStyle" IS NULL AND "name" = 'google';
UPDATE "Provider" SET "apiStyle" = 'openai_responses'
  WHERE "apiStyle" IS NULL AND "name" = 'codex';
UPDATE "Provider" SET "apiStyle" = 'openai_chat'
  WHERE "apiStyle" IS NULL;

-- AlterTable
ALTER TABLE "Provider" ALTER COLUMN "apiStyle" SET NOT NULL,
ALTER COLUMN "apiStyle" SET DEFAULT 'openai_chat';
