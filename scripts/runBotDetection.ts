#!/usr/bin/env bun
import 'core-js'
import detectBotFarms from 'helpers/detectBotFarms'
import prismaClient from 'helpers/prismaClient'
import 'reflect-metadata'

console.log('🕵️ Running bot farm detection...')

try {
  const result = await detectBotFarms()
  console.log('\n✅ Detection complete!')
  console.log(`📊 Results:`)
  console.log(`   - Addresses scanned: ${result.addressesScanned}`)
  console.log(`   - Suspicious addresses: ${result.suspiciousAddresses}`)
  console.log(`   - Users newly marked: ${result.usersMarked}`)
  console.log(`   - Users already marked: ${result.alreadyMarked}`)
} catch (error) {
  console.error('❌ Error running bot detection:', error)
  process.exit(1)
} finally {
  await prismaClient.$disconnect()
  process.exit(0)
}
