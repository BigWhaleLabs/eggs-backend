-- CreateTable
CREATE TABLE "ChickenLevelProcessedBlock" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "blockNumber" BIGINT NOT NULL,

    CONSTRAINT "ChickenLevelProcessedBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtraChickenProcessedBlock" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "blockNumber" BIGINT NOT NULL,

    CONSTRAINT "ExtraChickenProcessedBlock_pkey" PRIMARY KEY ("id")
);
