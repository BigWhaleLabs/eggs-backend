-- AlterTable
ALTER TABLE "EggTransaction" ADD COLUMN     "senderId" TEXT;

-- AddForeignKey
ALTER TABLE "EggTransaction" ADD CONSTRAINT "EggTransaction_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
