-- Subscription accounts discovered from local credential files.
-- Tokens are stored encrypted (never plaintext).

CREATE TABLE "SubAccount" (
  "id" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "sourcePath" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "userName" TEXT,
  "userEmail" TEXT,
  "userId" TEXT,
  "accountId" TEXT,
  "plan" TEXT,
  "rateLimitTier" TEXT,
  "expiresAt" TIMESTAMP(3),
  "scopes" JSONB,
  "accessTokenEnc" TEXT,
  "refreshTokenEnc" TEXT,
  "idTokenEnc" TEXT,
  "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SubAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SubAccount_providerId_sourcePath_key"
  ON "SubAccount"("providerId", "sourcePath");

CREATE INDEX "SubAccount_providerId_idx"
  ON "SubAccount"("providerId");

ALTER TABLE "Provider"
  ADD COLUMN "activeSubscriptionAccountId" TEXT;

ALTER TABLE "Provider"
  ADD CONSTRAINT "Provider_activeSubscriptionAccountId_fkey"
  FOREIGN KEY ("activeSubscriptionAccountId")
  REFERENCES "SubAccount"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "SubAccount"
  ADD CONSTRAINT "SubAccount_providerId_fkey"
  FOREIGN KEY ("providerId")
  REFERENCES "Provider"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
