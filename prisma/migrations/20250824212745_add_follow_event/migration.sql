-- CreateTable
CREATE TABLE "FollowEvent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "followerFid" TEXT NOT NULL,
    "followedUserId" TEXT NOT NULL,

    CONSTRAINT "FollowEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FollowEvent_followerFid_idx" ON "FollowEvent"("followerFid");

-- CreateIndex
CREATE INDEX "FollowEvent_followedUserId_idx" ON "FollowEvent"("followedUserId");

-- CreateIndex
CREATE INDEX "FollowEvent_createdAt_idx" ON "FollowEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FollowEvent_followerFid_followedUserId_key" ON "FollowEvent"("followerFid", "followedUserId");

-- AddForeignKey
ALTER TABLE "FollowEvent" ADD CONSTRAINT "FollowEvent_followedUserId_fkey" FOREIGN KEY ("followedUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
