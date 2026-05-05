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
  EGGS_CONTRACT_ADDRESS: str<`0x${string}`>(),
  BASE_RPC_URL: str(),
  CHICKENS_SUPER_HEN_PRIVATE_KEY: str<`0x${string}`>(),
})
