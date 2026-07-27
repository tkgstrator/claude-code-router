-- AlterTable
ALTER TABLE "RouterSlot" ADD COLUMN     "subagentModelId" TEXT;

-- AddForeignKey
ALTER TABLE "RouterSlot" ADD CONSTRAINT "RouterSlot_subagentModelId_fkey" FOREIGN KEY ("subagentModelId") REFERENCES "Model"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
