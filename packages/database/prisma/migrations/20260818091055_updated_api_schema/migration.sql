/*
  Warnings:

  - A unique constraint covering the columns `[userId]` on the table `ApiClient` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "ApiClient" ADD COLUMN     "userId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ApiClient_userId_key" ON "ApiClient"("userId");
