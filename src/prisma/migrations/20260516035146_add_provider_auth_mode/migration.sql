-- CreateEnum
CREATE TYPE "AuthMode" AS ENUM ('api_key', 'subscription');

-- AlterTable
ALTER TABLE "Provider" ADD COLUMN     "authMode" "AuthMode" NOT NULL DEFAULT 'api_key';
