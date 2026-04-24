-- AlterTable
ALTER TABLE "User" ADD COLUMN     "noBrowserHeader" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "repeatsReplayTokens" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ReplayToken" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "ReplayToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReplayToken_token_key" ON "ReplayToken"("token");

-- CreateIndex
CREATE INDEX "ReplayToken_userId_idx" ON "ReplayToken"("userId");

-- CreateIndex
CREATE INDEX "ReplayToken_createdAt_idx" ON "ReplayToken"("createdAt");

-- AddForeignKey
ALTER TABLE "ReplayToken" ADD CONSTRAINT "ReplayToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
