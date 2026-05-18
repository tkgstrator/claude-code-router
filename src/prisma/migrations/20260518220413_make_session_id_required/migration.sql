/*
  Warnings:

  - Made the column `sessionId` on table `RequestLog` required. This step will fail if there are existing NULL values in that column.

*/
-- Delete logs with no session (dev-only orphaned rows)
DELETE FROM "RequestLog" WHERE "sessionId" IS NULL;

-- DropForeignKey
ALTER TABLE "RequestLog" DROP CONSTRAINT "RequestLog_sessionId_fkey";

-- AlterTable
ALTER TABLE "RequestLog" ALTER COLUMN "sessionId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "RequestLog" ADD CONSTRAINT "RequestLog_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
