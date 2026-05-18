-- AlterTable
ALTER TABLE "RequestLog" ADD COLUMN     "sessionId" TEXT;

-- CreateIndex
CREATE INDEX "RequestLog_sessionId_idx" ON "RequestLog"("sessionId");
