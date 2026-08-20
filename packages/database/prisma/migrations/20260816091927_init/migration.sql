-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ASSISTANT', 'ERROR');

-- CreateEnum
CREATE TYPE "Mode" AS ENUM ('BUILD', 'PLAN');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('COMPLETE', 'INTERRUPTED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('TOPUP', 'USAGE', 'BONUS', 'REFUND', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "cwd" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "status" "MessageStatus" NOT NULL,
    "model" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "parts" JSONB,
    "mode" "Mode" NOT NULL,
    "duration" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiClient" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "creditBalance" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "monthlySpendCap" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditTransaction" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "credits" INTEGER NOT NULL,
    "ugxAmount" INTEGER,
    "momoRef" TEXT,
    "momoStatus" TEXT,
    "description" TEXT NOT NULL,
    "metadata" JSONB,
    "balanceAfter" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageRecord" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "transactionId" TEXT,
    "requestId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "generationType" TEXT,
    "promptTokens" INTEGER NOT NULL,
    "completionTokens" INTEGER NOT NULL,
    "totalTokens" INTEGER NOT NULL,
    "creditsUsed" INTEGER NOT NULL,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_createdAt_idx" ON "Session"("createdAt");

-- CreateIndex
CREATE INDEX "Message_sessionId_idx" ON "Message"("sessionId");

-- CreateIndex
CREATE INDEX "Message_sessionId_createdAt_idx" ON "Message"("sessionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApiClient_apiKey_key" ON "ApiClient"("apiKey");

-- CreateIndex
CREATE INDEX "ApiClient_isActive_idx" ON "ApiClient"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "CreditTransaction_momoRef_key" ON "CreditTransaction"("momoRef");

-- CreateIndex
CREATE INDEX "CreditTransaction_clientId_idx" ON "CreditTransaction"("clientId");

-- CreateIndex
CREATE INDEX "CreditTransaction_clientId_createdAt_idx" ON "CreditTransaction"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "CreditTransaction_type_idx" ON "CreditTransaction"("type");

-- CreateIndex
CREATE INDEX "CreditTransaction_createdAt_idx" ON "CreditTransaction"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UsageRecord_transactionId_key" ON "UsageRecord"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "UsageRecord_requestId_key" ON "UsageRecord"("requestId");

-- CreateIndex
CREATE INDEX "UsageRecord_clientId_idx" ON "UsageRecord"("clientId");

-- CreateIndex
CREATE INDEX "UsageRecord_clientId_createdAt_idx" ON "UsageRecord"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "UsageRecord_model_idx" ON "UsageRecord"("model");

-- CreateIndex
CREATE INDEX "UsageRecord_createdAt_idx" ON "UsageRecord"("createdAt");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "ApiClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "ApiClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
