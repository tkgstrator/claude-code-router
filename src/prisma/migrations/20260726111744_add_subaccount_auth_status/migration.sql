-- CreateEnum
CREATE TYPE "AuthStatus" AS ENUM ('unknown', 'live', 'invalid');

-- AlterTable
ALTER TABLE "SubAccount" ADD COLUMN     "authCheckedAt" TIMESTAMP(3),
ADD COLUMN     "authError" TEXT,
ADD COLUMN     "authStatus" "AuthStatus" NOT NULL DEFAULT 'unknown';
