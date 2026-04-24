-- CreateIndex
CREATE INDEX "EggTransaction_createdAt_idx" ON "EggTransaction"("createdAt");

-- CreateIndex
CREATE INDEX "EggTransaction_type_idx" ON "EggTransaction"("type");

-- CreateIndex
CREATE INDEX "EggTransaction_createdAt_type_idx" ON "EggTransaction"("createdAt", "type");

-- CreateIndex
CREATE INDEX "Hen_userId_idx" ON "Hen"("userId");

-- CreateIndex
CREATE INDEX "Referral_referredId_idx" ON "Referral"("referredId");

-- CreateIndex
CREATE INDEX "User_isVerifiedBot_idx" ON "User"("isVerifiedBot");
