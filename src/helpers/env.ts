import { configDotenv } from 'dotenv'
import 'dotenv/config'
import { cleanEnv, num, str } from 'envalid'

configDotenv({
  override: true,
})

export default cleanEnv(process.env, {
  PORT: num({ default: 1337 }),
  POSTGRES: str(),
  JWT_SECRET: str(),
  PRIVY_APP_ID: str(),
  PRIVY_APP_SECRET: str(),
  NEYNAR_API_KEY: str(),
  DISCORD_WEBHOOK_URL: str(),
  EGGS_CONTRACT_ADDRESS: str<`0x${string}`>(),
  SUPER_HEN_PRIVATE_KEY: str<`0x${string}`>(),
  BASE_RPC_URL: str(),
  OWNER_PRIVATE_KEY: str<`0x${string}`>(),
  CHICKENS_SUPER_HEN_PRIVATE_KEY: str<`0x${string}`>(),
  CHICKENS_CONTRACT_ADDRESS: str<`0x${string}`>(),
})
