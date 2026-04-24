-- CreateTable
CREATE TABLE "ChickenTransferProcessedBlock" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "blockNumber" BIGINT NOT NULL,

    CONSTRAINT "ChickenTransferProcessedBlock_pkey" PRIMARY KEY ("id")
);
