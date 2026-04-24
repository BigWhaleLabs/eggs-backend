-- CreateTable
CREATE TABLE "ChickenLevelUpgrade" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "henId" TEXT NOT NULL,
    "fromLevel" INTEGER NOT NULL,
    "toLevel" INTEGER NOT NULL,
    "result" INTEGER NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ChickenLevelUpgrade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChickenLevelUpgrade_henId_used_idx" ON "ChickenLevelUpgrade"("henId", "used");

-- AddForeignKey
ALTER TABLE "ChickenLevelUpgrade" ADD CONSTRAINT "ChickenLevelUpgrade_henId_fkey" FOREIGN KEY ("henId") REFERENCES "Hen"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
