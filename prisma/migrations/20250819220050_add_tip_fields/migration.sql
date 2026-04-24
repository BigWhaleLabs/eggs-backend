-- AlterTable
ALTER TABLE "User" ADD COLUMN     "tipsLeftForComments" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tipsLeftForLikes" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "TicketProcessedBlock" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "blockNumber" BIGINT NOT NULL,

    CONSTRAINT "TicketProcessedBlock_pkey" PRIMARY KEY ("id")
);
