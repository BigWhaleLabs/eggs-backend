-- CreateIndex
CREATE INDEX "Hen_level_idx" ON "Hen"("level");

-- CreateIndex
CREATE INDEX "Hen_userId_level_idx" ON "Hen"("userId", "level");

-- CreateIndex
CREATE INDEX "User_neynarUserScore_idx" ON "User"("neynarUserScore");
