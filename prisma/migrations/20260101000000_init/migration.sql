-- CreateEnum
CREATE TYPE "LaunchStatus" AS ENUM ('PRE_LAUNCH', 'CONTRACT_DEPLOYED', 'TRADING_NOT_LIVE', 'TRADING_LIVE', 'PAUSED', 'ANNOUNCEMENT_ONLY');

-- CreateTable
CREATE TABLE "Token" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL DEFAULT 'agalio',
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "decimals" INTEGER,
    "totalSupply" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "logoPath" TEXT,
    "logoFileId" TEXT,
    "launchStatus" "LaunchStatus" NOT NULL DEFAULT 'PRE_LAUNCH',
    "chainId" INTEGER NOT NULL DEFAULT 56,
    "buyUrl" TEXT,
    "chartUrl" TEXT,
    "communityUrl" TEXT,
    "websiteUrl" TEXT,
    "twitterUrl" TEXT,
    "whitepaperUrl" TEXT,
    "tokenomicsUrl" TEXT,
    "securityUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractAddress" (
    "id" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL DEFAULT 56,
    "isOfficial" BOOLEAN NOT NULL DEFAULT false,
    "setByUserId" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotConfiguration" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "announcementEnabled" BOOLEAN NOT NULL DEFAULT true,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "cooldownSeconds" INTEGER NOT NULL DEFAULT 60,
    "announcementTemplate" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramGroup" (
    "id" TEXT NOT NULL,
    "chatId" BIGINT NOT NULL,
    "title" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Administrator" (
    "id" TEXT NOT NULL,
    "telegramId" BIGINT NOT NULL,
    "username" TEXT,
    "addedBy" BIGINT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Administrator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "triggerMsgId" INTEGER,
    "telegramMessageId" INTEGER,
    "contract" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'AUTO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DetectedMessage" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "messageId" INTEGER NOT NULL,
    "userId" BIGINT,
    "contract" TEXT NOT NULL,
    "matched" BOOLEAN NOT NULL,
    "isForward" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DetectedMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ButtonConfiguration" (
    "id" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "label" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ButtonConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketDataSnapshot" (
    "id" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "priceUsd" TEXT,
    "liquidityUsd" TEXT,
    "marketCapUsd" TEXT,
    "fdvUsd" TEXT,
    "volume24hUsd" TEXT,
    "priceChange24h" TEXT,
    "pairAddress" TEXT,
    "dexName" TEXT,
    "chartUrl" TEXT,
    "pairCreatedAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketDataSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" BIGINT,
    "action" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotEvent" (
    "id" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Token_slug_key" ON "Token"("slug");

-- CreateIndex
CREATE INDEX "ContractAddress_address_idx" ON "ContractAddress"("address");

-- CreateIndex
CREATE UNIQUE INDEX "ContractAddress_tokenId_address_key" ON "ContractAddress"("tokenId", "address");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramGroup_chatId_key" ON "TelegramGroup"("chatId");

-- CreateIndex
CREATE UNIQUE INDEX "Administrator_telegramId_key" ON "Administrator"("telegramId");

-- CreateIndex
CREATE INDEX "Announcement_groupId_createdAt_idx" ON "Announcement"("groupId", "createdAt");

-- CreateIndex
CREATE INDEX "DetectedMessage_createdAt_idx" ON "DetectedMessage"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DetectedMessage_groupId_messageId_contract_key" ON "DetectedMessage"("groupId", "messageId", "contract");

-- CreateIndex
CREATE UNIQUE INDEX "ButtonConfiguration_tokenId_key_key" ON "ButtonConfiguration"("tokenId", "key");

-- CreateIndex
CREATE INDEX "MarketDataSnapshot_tokenId_fetchedAt_idx" ON "MarketDataSnapshot"("tokenId", "fetchedAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "BotEvent_type_createdAt_idx" ON "BotEvent"("type", "createdAt");

-- AddForeignKey
ALTER TABLE "ContractAddress" ADD CONSTRAINT "ContractAddress_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TelegramGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DetectedMessage" ADD CONSTRAINT "DetectedMessage_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TelegramGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ButtonConfiguration" ADD CONSTRAINT "ButtonConfiguration_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketDataSnapshot" ADD CONSTRAINT "MarketDataSnapshot_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE CASCADE ON UPDATE CASCADE;
