import prismaClient from './prismaClient'

export default async function cleanupOldReplayTokens() {
  try {
    console.log(
      '[REPLAY_TOKEN_CLEANUP] 🧹 Starting cleanup of old replay tokens...',
    )

    // Delete replay tokens older than 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

    const result = await prismaClient.replayToken.deleteMany({
      where: {
        createdAt: {
          lt: thirtyDaysAgo,
        },
      },
    })

    console.log(
      `[REPLAY_TOKEN_CLEANUP] ✅ Cleaned up ${result.count} old replay tokens`,
    )

    return result.count
  } catch (error) {
    console.error(
      '[REPLAY_TOKEN_CLEANUP] ❌ Error cleaning up replay tokens:',
      error,
    )
    throw error
  }
}
