-- CreateEnum
CREATE TYPE "JackpotTicketType" AS ENUM ('HOLD', 'UPGRADE', 'CLAIM_STREAK', 'REFERRAL');

-- CreateTable
CREATE TABLE "JackpotTicket" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "JackpotTicketType" NOT NULL,
    "claimed" BOOLEAN NOT NULL DEFAULT false,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "amount" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "JackpotTicket_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "JackpotTicket" ADD CONSTRAINT "JackpotTicket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
