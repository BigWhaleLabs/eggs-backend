/*
  Warnings:

  - You are about to drop the column `used` on the `JackpotTicket` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "JackpotTicket" DROP COLUMN "used";

-- CreateTable
CREATE TABLE "JackpotTicketClaimCoupon" (
    "id" TEXT NOT NULL,
    "serialId" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "address" TEXT NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "signature" TEXT,
    "message" TEXT,
    "jackpotId" INTEGER NOT NULL,

    CONSTRAINT "JackpotTicketClaimCoupon_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JackpotTicketClaimCoupon_serialId_key" ON "JackpotTicketClaimCoupon"("serialId");

-- CreateIndex
CREATE INDEX "JackpotTicketClaimCoupon_used_createdAt_idx" ON "JackpotTicketClaimCoupon"("used", "createdAt");

-- AddForeignKey
ALTER TABLE "JackpotTicketClaimCoupon" ADD CONSTRAINT "JackpotTicketClaimCoupon_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
