-- CreateEnum
CREATE TYPE "ApiStyle" AS ENUM ('openai_chat', 'openai_responses', 'anthropic', 'gemini');

-- AlterTable
ALTER TABLE "Provider" ADD COLUMN     "apiStyle" "ApiStyle";
