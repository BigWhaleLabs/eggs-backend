-- AlterTable
ALTER TABLE "User" ADD COLUMN     "unclaimedDegen" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "DegenClaimCoupon" (
    "id" TEXT NOT NULL,
    "serialId" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "address" TEXT NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "signature" TEXT,
    "message" TEXT,

    CONSTRAINT "DegenClaimCoupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DegenTransaction" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "DegenTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DegenClaimCoupon_serialId_key" ON "DegenClaimCoupon"("serialId");

-- CreateIndex
CREATE INDEX "DegenClaimCoupon_used_createdAt_idx" ON "DegenClaimCoupon"("used", "createdAt");

-- AddForeignKey
ALTER TABLE "DegenClaimCoupon" ADD CONSTRAINT "DegenClaimCoupon_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DegenTransaction" ADD CONSTRAINT "DegenTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
