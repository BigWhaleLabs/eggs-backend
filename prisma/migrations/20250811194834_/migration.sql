/*
  Warnings:

  - A unique constraint covering the columns `[transactionHash]` on the table `ChickenLevelUpgrade` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "ChickenLevelUpgrade" ADD COLUMN     "transactionHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ChickenLevelUpgrade_transactionHash_key" ON "ChickenLevelUpgrade"("transactionHash");
