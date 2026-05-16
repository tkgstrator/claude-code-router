-- CreateEnum
CREATE TYPE "ModelTestStatus" AS ENUM ('unknown', 'ok', 'fail');

-- AlterTable
ALTER TABLE "Model" ADD COLUMN     "testCheckedAt" TIMESTAMP(3),
ADD COLUMN     "testError" TEXT,
ADD COLUMN     "testPassedAt" TIMESTAMP(3),
ADD COLUMN     "testStatus" "ModelTestStatus" NOT NULL DEFAULT 'unknown';
