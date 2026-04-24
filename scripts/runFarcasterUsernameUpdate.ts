#!/usr/bin/env bun
import 'core-js'
import prismaClient from 'helpers/prismaClient'
import updateFarcasterData from 'helpers/updateFarcasterData'
import 'reflect-metadata'

console.log('[FARCASTER_DATA_SCRIPT] 🔄 Running Farcaster data update...')

try {
  const result = await updateFarcasterData()
  console.log('[FARCASTER_DATA_SCRIPT] \n✅ Update complete!')
  console.log('[FARCASTER_DATA_SCRIPT] 📊 Results:')
  console.log(
    `[FARCASTER_DATA_SCRIPT]    - Total checked: ${result.totalChecked}`,
  )
  console.log(
    `[FARCASTER_DATA_SCRIPT]    - Usernames updated: ${result.usernamesUpdated}`,
  )
  console.log(
    `[FARCASTER_DATA_SCRIPT]    - Usernames unchanged: ${result.usernamesUnchanged}`,
  )
  console.log(
    `[FARCASTER_DATA_SCRIPT]    - Scores updated: ${result.scoresUpdated}`,
  )
  console.log(
    `[FARCASTER_DATA_SCRIPT]    - Scores unchanged: ${result.scoresUnchanged}`,
  )
  console.log(
    `[FARCASTER_DATA_SCRIPT]    - Referrals verified: ${result.referralsVerified}`,
  )
  console.log(`[FARCASTER_DATA_SCRIPT]    - Errors: ${result.errors}`)
} catch (error) {
  console.error(
    '[FARCASTER_DATA_SCRIPT] ❌ Error running Farcaster data update:',
    error,
  )
  process.exit(1)
} finally {
  await prismaClient.$disconnect()
  process.exit(0)
}
