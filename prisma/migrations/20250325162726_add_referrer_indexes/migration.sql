-- CreateIndex
CREATE INDEX "Referral_referrerId_idx" ON "Referral"("referrerId");

-- CreateIndex
CREATE INDEX "Referral_referrerId_verified_idx" ON "Referral"("referrerId", "verified");
