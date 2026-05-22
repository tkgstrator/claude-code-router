-- AlterTable
ALTER TABLE "SubAccount" ADD COLUMN     "monthlyPriceUsd" DOUBLE PRECISION,
ALTER COLUMN "updatedAt" DROP DEFAULT;
