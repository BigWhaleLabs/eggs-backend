-- CreateEnum
CREATE TYPE "TippingType" AS ENUM ('LIKE', 'REPLY');

-- CreateTable
CREATE TABLE "TippingTransaction" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tipperId" TEXT NOT NULL,
    "tippedUserId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "type" "TippingType" NOT NULL,
    "farcasterCastHash" TEXT,
    "farcasterReplyText" TEXT,

    CONSTRAINT "TippingTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TippingTransaction_tipperId_idx" ON "TippingTransaction"("tipperId");

-- CreateIndex
CREATE INDEX "TippingTransaction_tippedUserId_idx" ON "TippingTransaction"("tippedUserId");

-- CreateIndex
CREATE INDEX "TippingTransaction_createdAt_idx" ON "TippingTransaction"("createdAt");

-- AddForeignKey
ALTER TABLE "TippingTransaction" ADD CONSTRAINT "TippingTransaction_tipperId_fkey" FOREIGN KEY ("tipperId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TippingTransaction" ADD CONSTRAINT "TippingTransaction_tippedUserId_fkey" FOREIGN KEY ("tippedUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
