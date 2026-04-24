-- AlterTable
ALTER TABLE "Hen" ADD COLUMN     "originalOwnerId" TEXT;

-- CreateIndex
CREATE INDEX "Hen_originalOwnerId_idx" ON "Hen"("originalOwnerId");

-- AddForeignKey
ALTER TABLE "Hen" ADD CONSTRAINT "Hen_originalOwnerId_fkey" FOREIGN KEY ("originalOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
