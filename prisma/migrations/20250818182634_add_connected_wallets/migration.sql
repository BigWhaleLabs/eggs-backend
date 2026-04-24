-- CreateTable
CREATE TABLE "ConnectedWallet" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "verificationId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "lastVerified" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConnectedWallet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConnectedWallet_verificationId_idx" ON "ConnectedWallet"("verificationId");

-- CreateIndex
CREATE INDEX "ConnectedWallet_address_idx" ON "ConnectedWallet"("address");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectedWallet_verificationId_address_key" ON "ConnectedWallet"("verificationId", "address");

-- AddForeignKey
ALTER TABLE "ConnectedWallet" ADD CONSTRAINT "ConnectedWallet_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "Verification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
